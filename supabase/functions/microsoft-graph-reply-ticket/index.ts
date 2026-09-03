// microsoft-graph-reply-ticket: sender et svar på et eksisterende ticket
// (Microsoft Graph melding) via lagret M365 OAuth-token (microsoft_oauth_tokens).
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

    const { data: canWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ordre" });
    if (!canWrite) return json({ error: "Ingen tilgang" }, 403);

    const body = await req.json() as {
      ticket_id?: string;
      body_html?: string;
      mark_resolved?: boolean;
      /** Klient-generert nøkkel — logges for sporbarhet ved dobbeltsending. */
      idempotency_key?: string;
    };
    if (!body.ticket_id || !body.body_html?.trim()) {
      return json({ error: "ticket_id og body_html kreves" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: ticket, error: tErr } = await userClient
      .from("tickets")
      .select("id, microsoft_message_id, source_mailbox, subject, sender_email, assigned_to")
      .eq("id", body.ticket_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) return json({ error: "Ticket ikke funnet" }, 404);
    if (!ticket.microsoft_message_id) return json({ error: "Ticket mangler microsoft_message_id" }, 400);

    // Hent signatur (best-effort)
    const { data: sigRow } = await admin.from("platform_settings")
      .select("value").eq("category", "ordre_email").eq("key", "email_signature").maybeSingle();
    const signatureHtml = (sigRow?.value as { html?: string } | null)?.html ?? "";
    const finalHtml = body.body_html + (signatureHtml ? `<br/><br/>${signatureHtml}` : "");

    // Access token fra lagret M365-tilkobling (samme kilde som webhook/vedlegg).
    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")!;
    const { data: tokenRow } = await admin.from("microsoft_oauth_tokens")
      .select("id, access_token_encrypted, refresh_token_encrypted, expires_at")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!tokenRow) return json({ error: "Ingen M365-token konfigurert — koble til Microsoft-kontoen" }, 500);
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

    const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(ticket.microsoft_message_id)}/reply`;
    const graphRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: { body: { contentType: "HTML", content: finalHtml } },
      }),
    });
    if (!graphRes.ok) {
      const errTxt = await graphRes.text();
      return json({ error: `Graph reply feilet (${graphRes.status}): ${errTxt}` }, 502);
    }


    const patch: Record<string, unknown> = {
      status: body.mark_resolved ? "resolved" : "in_progress",
    };
    // Eierskap skal ALDRI overstyres av at noen svarer på vegne av andre.
    if (!ticket.assigned_to) patch.assigned_to = user.id;
    await admin.from("tickets").update(patch).eq("id", ticket.id);

    return json({
      success: true,
      sent_to: ticket.sender_email,
      idempotency_key: body.idempotency_key ?? null,
    });
  } catch (e) {
    console.error("microsoft-graph-reply-ticket error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
