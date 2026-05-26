// Sender en ordrebekreftelse som er forhåndsvist og redigert av saksbehandler.
// Bruker delt postboks via Microsoft Graph. Logger til order_confirmations_sent,
// og hvis ticket_id er oppgitt — også til ticket_replies.
//
// Body: { order_id, recipient_email, subject, body_html, body_text?, language,
//         edited_by_user?, ticket_id?, variables_snapshot? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const { data: hasWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ordre" });
    if (!hasWrite) return json({ error: "Forbidden" }, 403);

    const body = await req.json() as {
      order_id?: string;
      recipient_email?: string;
      subject?: string;
      body_html?: string;
      body_text?: string;
      language?: string;
      edited_by_user?: boolean;
      ticket_id?: string;
      variables_snapshot?: Record<string, unknown>;
    };
    if (!body.order_id || !body.recipient_email || !body.subject || !body.body_html) {
      return json({ error: "order_id, recipient_email, subject og body_html kreves" }, 400);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.recipient_email)) {
      return json({ error: "Ugyldig mottakeradresse" }, 400);
    }

    // Signatur
    const { data: sigRow } = await admin.from("platform_settings")
      .select("value").eq("category", "ordre_email").eq("key", "email_signature").maybeSingle();
    const signatureHtml = (sigRow?.value as { html?: string } | null)?.html ?? "";
    const finalHtml = body.body_html + (signatureHtml ? `<br/><br/>${signatureHtml}` : "");

    // Token
    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID");
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID");
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET");
    if (!tenantId || !clientId || !clientSecret) return json({ error: "Microsoft Graph er ikke konfigurert" }, 500);

    const { data: tokenRow } = await admin.from("microsoft_oauth_tokens")
      .select("id,account_email,access_token_encrypted,refresh_token_encrypted,expires_at")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!tokenRow) return json({ error: "Microsoft 365 er ikke koblet til" }, 412);

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

    const mailbox = tokenRow.account_email;
    let sendError: string | null = null;
    let microsoftMessageId: string | null = null;
    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: body.subject,
            body: { contentType: "HTML", content: finalHtml },
            toRecipients: [{ emailAddress: { address: body.recipient_email } }],
          },
          saveToSentItems: true,
        }),
      });
      if (!res.ok) sendError = `Graph sendMail feilet (${res.status}): ${await res.text()}`;
      else microsoftMessageId = res.headers.get("x-ms-message-id");
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
    }

    // Logg uansett
    const status = sendError ? "failed" : "sent";
    const { data: logRow } = await admin.from("order_confirmations_sent").insert({
      order_id: body.order_id,
      ticket_id: body.ticket_id ?? null,
      recipient_email: body.recipient_email,
      subject: body.subject,
      body_html: body.body_html,
      body_text: body.body_text ?? null,
      language: body.language ?? "nb",
      edited_by_user: !!body.edited_by_user,
      variables_snapshot: body.variables_snapshot ?? null,
      sent_by: userId,
      sent_from: mailbox,
      microsoft_message_id: microsoftMessageId,
      send_status: status,
      error_message: sendError,
    }).select("id").maybeSingle();

    // Speil i ticket-tråd hvis koblet
    if (!sendError && body.ticket_id) {
      await admin.from("ticket_replies").insert({
        ticket_id: body.ticket_id,
        body_text: (body.body_text ?? "") || "(ordrebekreftelse)",
        body_rendered: finalHtml,
        sent_by: userId,
        send_status: "sent",
        sent_at: new Date().toISOString(),
        microsoft_message_id: microsoftMessageId,
      }).then(() => {}, () => {});
    }

    // Tidslinje-hendelse
    await admin.from("ticket_events").insert({
      ticket_id: body.ticket_id ?? null,
      order_id: body.order_id ?? null,
      event_type: "confirmation.sent",
      actor_type: "staff",
      actor_user_id: userId,
      actor_label: userRes?.user?.email ?? null,
      summary: sendError
        ? `Feilet til ${body.recipient_email}: ${sendError}`
        : `${body.subject} → ${body.recipient_email}`,
      payload: {
        send_status: sendError ? "failed" : "sent",
        confirmation_id: logRow?.id ?? null,
        mailbox,
      },
    }).then(() => {}, () => {});

    if (sendError) return json({ error: sendError, confirmation_id: logRow?.id }, 502);
    return json({ success: true, confirmation_id: logRow?.id, sent_to: body.recipient_email, sent_from: mailbox });
  } catch (e) {
    console.error("send-order-confirmation error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
