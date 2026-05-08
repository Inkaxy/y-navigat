// microsoft-graph-reply-ticket: sender et svar på et eksisterende ticket
// (Microsoft Graph melding) fra delt postboks. Bruker Graph /reply som
// automatisk håndterer subject/threading/In-Reply-To.
//
// Body: { ticket_id: string, body_html: string, mark_resolved?: boolean }
// Krever innlogget bruker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json() as {
      ticket_id?: string;
      body_html?: string;
      mark_resolved?: boolean;
    };
    if (!body.ticket_id || !body.body_html?.trim()) {
      return json({ error: "ticket_id og body_html kreves" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Hent ticket
    const { data: ticket, error: tErr } = await admin
      .from("tickets")
      .select("id, microsoft_message_id, source_mailbox, subject, sender_email")
      .eq("id", body.ticket_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) return json({ error: "Ticket ikke funnet" }, 404);

    // Hent + refresh M365-token
    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")!;

    const { data: tokenRow } = await admin.from("microsoft_oauth_tokens")
      .select("id, account_email, access_token_encrypted, refresh_token_encrypted, expires_at")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!tokenRow) return json({ error: "Microsoft 365 ikke koblet til" }, 412);

    let accessToken = await decryptToken(tokenRow.access_token_encrypted);
    if (new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
      const refresh = await decryptToken(tokenRow.refresh_token_encrypted);
      const fresh = await refreshAccessToken({ tenantId, clientId, clientSecret, refreshToken: refresh });
      accessToken = fresh.access_token;
      await admin.from("microsoft_oauth_tokens").update({
        access_token_encrypted: await encryptToken(fresh.access_token),
        refresh_token_encrypted: await encryptToken(fresh.refresh_token ?? refresh),
        expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
        last_refresh_at: new Date().toISOString(),
      }).eq("id", tokenRow.id);
    }

    // Hent signatur (best-effort)
    const { data: sigRow } = await admin.from("platform_settings")
      .select("value").eq("category", "ordre_email").eq("key", "email_signature").maybeSingle();
    const signatureHtml = (sigRow?.value as { html?: string } | null)?.html ?? "";
    const finalHtml = body.body_html + (signatureHtml ? `<br/><br/>${signatureHtml}` : "");

    const mailbox = tokenRow.account_email;
    // Graph /reply: svarer på den opprinnelige meldingen, beholder tråd.
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${ticket.microsoft_message_id}/reply`;
    const graphRes = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { body: { contentType: "HTML", content: finalHtml } },
      }),
    });
    if (!graphRes.ok) {
      const errTxt = await graphRes.text();
      return json({ error: `Graph reply feilet (${graphRes.status}): ${errTxt}` }, 502);
    }

    // Oppdater ticket: in_progress (eller resolved hvis ønsket), assigned_to settes til avsender
    const patch: Record<string, unknown> = {
      status: body.mark_resolved ? "resolved" : "in_progress",
      assigned_to: user.id,
    };
    await admin.from("tickets").update(patch).eq("id", ticket.id);

    return json({ success: true, sent_to: ticket.sender_email });
  } catch (e) {
    console.error("microsoft-graph-reply-ticket error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
