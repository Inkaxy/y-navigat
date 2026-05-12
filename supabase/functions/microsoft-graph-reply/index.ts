// microsoft-graph-reply: Sender et plain-text svar på en eksisterende ticket
// via Microsoft Graph /reply (beholder tråd/In-Reply-To). Logger til
// public.ticket_replies og setter ticket-status til 'in_progress'.
//
// Body: { ticket_id: uuid, body_text: string }
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

    const body = (await req.json()) as { ticket_id?: string; body_text?: string };
    if (!body.ticket_id || !body.body_text?.trim()) {
      return json({ error: "ticket_id og body_text kreves" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Sjekk skrivetilgang
    const { data: writeOk, error: accErr } = await admin.rpc("has_app_write_access", { _app_slug: "ordre" });
    if (accErr || !writeOk) {
      // Prøv uten arg-navn (fallback)
      const { data: writeOk2 } = await admin.rpc("has_app_write_access" as never, { app_slug: "ordre" } as never);
      if (!writeOk2) return json({ error: "Mangler skrivetilgang til Ordre" }, 403);
    }

    // Hent ticket
    const { data: ticket, error: tErr } = await admin
      .from("tickets")
      .select("id, microsoft_message_id, source_mailbox, subject, sender_email, sender_name, conversation_id, body_text, body_preview, status")
      .eq("id", body.ticket_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) return json({ error: "Ticket ikke funnet" }, 404);

    // Hent template (kan være null)
    const { data: tpl } = await admin
      .from("email_templates")
      .select("body_text_template")
      .eq("template_key", "ticket_reply")
      .maybeSingle();

    const vars: Record<string, string> = {
      kunde_navn: ticket.sender_name ?? ticket.sender_email,
      kunde_epost: ticket.sender_email,
      original_emne: ticket.subject ?? "",
      original_melding: (ticket.body_text ?? ticket.body_preview ?? "").slice(0, 500),
      ticket_nr: ticket.id.slice(-8),
      svar_tekst: body.body_text,
    };
    const rendered = tpl?.body_text_template
      ? renderTemplate(tpl.body_text_template, vars)
      : body.body_text;

    // Insert pending reply
    const { data: reply, error: rErr } = await admin
      .from("ticket_replies")
      .insert({
        ticket_id: ticket.id,
        body_text: body.body_text,
        body_rendered: rendered,
        sent_by: user.id,
        send_status: "pending",
        microsoft_conversation_id: ticket.conversation_id,
      })
      .select("id")
      .single();
    if (rErr) throw rErr;

    // Hent + refresh M365 token
    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")!;

    const { data: tokenRow } = await admin
      .from("microsoft_oauth_tokens")
      .select("id, account_email, access_token_encrypted, refresh_token_encrypted, expires_at")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!tokenRow) {
      await admin.from("ticket_replies").update({
        send_status: "failed", error_message: "Microsoft 365 ikke koblet til",
      }).eq("id", reply.id);
      return json({ error: "Microsoft 365 ikke koblet til" }, 412);
    }

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

    const mailbox = ticket.source_mailbox || tokenRow.account_email;
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${ticket.microsoft_message_id}/reply`;
    const graphRes = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment: rendered }),
    });

    if (!graphRes.ok) {
      const errTxt = await graphRes.text();
      await admin.from("ticket_replies").update({
        send_status: "failed",
        error_message: `Graph ${graphRes.status}: ${errTxt}`.slice(0, 1000),
      }).eq("id", reply.id);
      return json({ error: `Graph reply feilet (${graphRes.status})`, detail: errTxt }, 502);
    }
    await graphRes.text();

    await admin.from("ticket_replies").update({
      send_status: "sent",
      sent_at: new Date().toISOString(),
    }).eq("id", reply.id);

    if (ticket.status === "new") {
      await admin.from("tickets").update({ status: "in_progress" }).eq("id", ticket.id);
    }

    return json({ success: true, reply_id: reply.id });
  } catch (e) {
    console.error("microsoft-graph-reply error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
