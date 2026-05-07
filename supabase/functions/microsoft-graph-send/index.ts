// microsoft-graph-send (B.1): Renderer template + sender via Microsoft Graph
// fra delt postboks ordre@notterobakeri.no.
//
// Body: { template_key, recipient_email, variables?, related_entity_type?, related_entity_id? }
// - Authenticated calls: rendrer + sender direkte (test-send fra UI).
// - Service-role calls (fra outbox-prosessor): sender uten å validere user-JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  template_key: string;
  recipient_email: string;
  variables?: Record<string, string>;
  subject_override?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isService = authHeader === `Bearer ${serviceKey}`;

    if (!isService) {
      // Krev innlogget bruker for direkte testsending fra UI
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
      if (!claims?.claims) return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as Body;
    if (!body?.template_key || !body?.recipient_email) {
      return json({ error: "template_key og recipient_email er påkrevd" }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    // 1) Hent template
    const { data: tpl, error: tplErr } = await admin
      .from("email_templates")
      .select("subject_template, body_html_template, body_text_template, is_active")
      .eq("template_key", body.template_key)
      .maybeSingle();
    if (tplErr) throw new Error(`Kunne ikke laste mal: ${tplErr.message}`);
    if (!tpl) return json({ error: `Mal ikke funnet: ${body.template_key}` }, 404);
    if (!tpl.is_active) return json({ error: `Mal er deaktivert: ${body.template_key}` }, 400);

    // 2) Hent signatur (best-effort)
    const { data: sigRow } = await admin
      .from("platform_settings")
      .select("value")
      .eq("category", "ordre_email")
      .eq("key", "email_signature")
      .maybeSingle();
    const signatureHtml = (sigRow?.value as { html?: string } | null)?.html ?? "";

    const vars = body.variables ?? {};
    const subject = body.subject_override ?? renderTemplate(tpl.subject_template ?? "", vars);
    const htmlBody = renderTemplate(tpl.body_html_template ?? "", vars) +
      (signatureHtml ? `<br/><br/>${signatureHtml}` : "");
    const textBody = tpl.body_text_template
      ? renderTemplate(tpl.body_text_template, vars)
      : null;

    // 3) Hent + refresh token for delt postboks
    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID");
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID");
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET");
    if (!tenantId || !clientId || !clientSecret) {
      return json({ error: "Microsoft Graph er ikke konfigurert" }, 500);
    }

    const { data: tokenRow, error: tokErr } = await admin
      .from("microsoft_oauth_tokens")
      .select("id, account_email, access_token_encrypted, refresh_token_encrypted, expires_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tokErr) throw new Error(`Kunne ikke lese token: ${tokErr.message}`);
    if (!tokenRow) return json({ error: "Microsoft 365 er ikke koblet til" }, 412);

    let accessToken = await decryptToken(tokenRow.access_token_encrypted);
    const expiresSoon = new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000;
    if (expiresSoon) {
      const refresh = await decryptToken(tokenRow.refresh_token_encrypted);
      const fresh = await refreshAccessToken({ tenantId, clientId, clientSecret, refreshToken: refresh });
      accessToken = fresh.access_token;
      await admin
        .from("microsoft_oauth_tokens")
        .update({
          access_token_encrypted: await encryptToken(fresh.access_token),
          refresh_token_encrypted: await encryptToken(fresh.refresh_token ?? refresh),
          expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
          last_refresh_at: new Date().toISOString(),
        })
        .eq("id", tokenRow.id);
    }

    // 4) Send via Graph /users/{mailbox}/sendMail
    const mailbox = tokenRow.account_email;
    const message: Record<string, unknown> = {
      subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: [{ emailAddress: { address: body.recipient_email } }],
    };
    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
      },
    );
    if (!graphRes.ok) {
      const errTxt = await graphRes.text();
      return json(
        { success: false, error: `Graph sendMail feilet (${graphRes.status}): ${errTxt}` },
        502,
      );
    }
    // Konsumer body for å unngå resource leak
    await graphRes.text();

    return json({
      success: true,
      sent_from: mailbox,
      sent_to: body.recipient_email,
      subject,
      text_fallback: textBody !== null,
    });
  } catch (e) {
    console.error("microsoft-graph-send error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** Erstatter {{var}}-plassholdere i en streng. */
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
