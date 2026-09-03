// Public webhook for Microsoft Graph notifications (verify_jwt=false).
// Handles validation handshake (?validationToken=...) and message-created
// notifications. For each new message, fetches the full message + attachments
// via Graph and inserts a tickets-row + ticket_attachments rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 1) Handshake: Microsoft sends GET or POST with ?validationToken=...
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const payload = await req.json();
    const notifications: Array<{
      subscriptionId: string;
      clientState?: string;
      resource: string;
      resourceData?: { id?: string };
    }> = payload?.value ?? [];

    if (!notifications.length) return json({ ok: true });

    // Validate clientState for each notification
    const subIds = [...new Set(notifications.map((n) => n.subscriptionId))];
    const { data: subs } = await admin
      .from("ticket_subscriptions")
      .select("microsoft_subscription_id, client_state")
      .in("microsoft_subscription_id", subIds);
    const clientStateMap = new Map(subs?.map((s) => [s.microsoft_subscription_id, s.client_state]) ?? []);

    // Refresh M365 token once
    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")!;
    const { data: tokenRow } = await admin.from("microsoft_oauth_tokens")
      .select("id, account_email, access_token_encrypted, refresh_token_encrypted, expires_at")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!tokenRow) {
      console.error("No M365 token");
      return new Response(null, { status: 202 });
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

    for (const n of notifications) {
      const expectedState = clientStateMap.get(n.subscriptionId);
      if (!expectedState || expectedState !== n.clientState) {
        console.warn("Invalid clientState for", n.subscriptionId);
        continue;
      }
      const messageId = n.resourceData?.id;
      if (!messageId) continue;

      try {
        await processMessage(admin, accessToken, tokenRow.account_email, messageId);
      } catch (err) {
        console.error("processMessage failed", messageId, err);
      }
    }

    return new Response(null, { status: 202 });
  } catch (e) {
    console.error("webhook error", e);
    // Always 202 so Microsoft doesn't disable subscription
    return new Response(null, { status: 202 });
  }
});

async function processMessage(
  admin: ReturnType<typeof createClient>,
  accessToken: string,
  mailbox: string,
  messageId: string,
) {
  // Fetch full message
  const msgRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=id,internetMessageId,subject,body,bodyPreview,from,toRecipients,ccRecipients,hasAttachments,receivedDateTime,importance,conversationId`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!msgRes.ok) {
    console.error("Graph message fetch failed", msgRes.status, await msgRes.text());
    return;
  }
  const msg = await msgRes.json();

  // Idempotency across both tables
  const { data: existingTicket } = await admin.from("tickets")
    .select("id").eq("microsoft_message_id", msg.id).maybeSingle();
  if (existingTicket) return;
  const { data: existingInbound } = await admin.from("ticket_inbound_messages")
    .select("id").eq("microsoft_message_id", msg.id).maybeSingle();
  if (existingInbound) return;

  const senderEmail = msg.from?.emailAddress?.address ?? "ukjent@ukjent";
  const senderName = msg.from?.emailAddress?.name ?? null;
  const bodyHtml = msg.body?.contentType === "html" ? msg.body?.content : null;
  const bodyText = msg.body?.contentType === "text" ? msg.body?.content : stripHtml(msg.body?.content ?? "");

  // Check if this belongs to an existing conversation → thread onto existing ticket
  let parentTicket: { id: string; awaiting_external: boolean; awaiting_external_email: string | null; assigned_to: string | null; subject: string | null; related_order_id: string | null } | null = null;
  if (msg.conversationId) {
    const { data: prior } = await admin
      .from("tickets")
      .select("id, awaiting_external, awaiting_external_email, assigned_to, subject, related_order_id")
      .eq("conversation_id", msg.conversationId)
      .order("received_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (prior) parentTicket = prior as typeof parentTicket;
  }

  // Fallback: [T-xxxxxxxx] tag in subject (replies after external forward get a new conversationId)
  if (!parentTicket && msg.subject) {
    const match = /\[T-([0-9a-fA-F]{8})\]/i.exec(msg.subject);
    if (match) {
      const { data: shortId } = await admin.rpc("find_ticket_by_short_id", {
        p_short: match[1].toLowerCase(),
      });
      if (shortId) {
        const { data: tagged } = await admin
          .from("tickets")
          .select("id, awaiting_external, awaiting_external_email, assigned_to, subject, related_order_id")
          .eq("id", shortId)
          .maybeSingle();
        if (tagged) parentTicket = tagged as typeof parentTicket;
      }
    }
  }

  if (parentTicket) {
    // Detect if this is a reply from the external we forwarded to
    const isFromExternalForward =
      parentTicket.awaiting_external &&
      parentTicket.awaiting_external_email != null &&
      senderEmail.toLowerCase() === parentTicket.awaiting_external_email.toLowerCase();

    const { data: inboundRow, error: insErr } = await admin.from("ticket_inbound_messages").insert({
      ticket_id: parentTicket.id,
      microsoft_message_id: msg.id,
      microsoft_internet_message_id: msg.internetMessageId ?? null,
      conversation_id: msg.conversationId ?? null,
      sender_email: senderEmail,
      sender_name: senderName,
      subject: msg.subject ?? null,
      body_html: bodyHtml,
      body_text: bodyText,
      body_preview: msg.bodyPreview ?? null,
      has_attachments: !!msg.hasAttachments,
      received_at: msg.receivedDateTime,
      is_from_external_forward: isFromExternalForward,
    }).select("id").single();
    if (insErr) {
      console.error("Insert inbound message failed", insErr);
      return;
    }

    // Reopen ticket + clear the correct waiting flag
    const patch: Record<string, unknown> = { status: "in_progress" };
    if (isFromExternalForward) {
      patch.awaiting_external = false;
      patch.awaiting_external_email = null;
    }
    await admin.from("tickets").update(patch).eq("id", parentTicket.id);

    await admin.from("ticket_events").insert({
      ticket_id: parentTicket.id,
      event_type: isFromExternalForward ? "external.replied" : "customer.replied",
      actor_type: "customer",
      actor_label: senderEmail,
      summary: msg.subject ?? null,
      payload: {
        conversation_id: msg.conversationId ?? null,
        inbound_message_id: msg.id,
      },
    });

    // Varsel til tildelt bruker om kundesvar
    if (!isFromExternalForward && parentTicket.assigned_to) {
      await admin.from("notifications").insert({
        user_id: parentTicket.assigned_to,
        type: "ticket.customer_reply",
        title: `Nytt svar fra ${senderName ?? senderEmail}`,
        body: parentTicket.subject ?? msg.subject ?? null,
        link: `/ordre/ticket/${parentTicket.id}`,
        ticket_id: parentTicket.id,
        order_id: parentTicket.related_order_id,
      });
    }

    // Attachments (inline images inkludert) på svaret lagres også på parent-ticket
    await fetchAndStoreAttachments(
      admin,
      accessToken,
      messageId,
      parentTicket.id,
      inboundRow?.id ?? null,
    );
    return;
  }

  // No existing conversation → create new ticket
  const { data: ticketRow, error: insErr } = await admin.from("tickets").insert({
    microsoft_message_id: msg.id,
    microsoft_internet_message_id: msg.internetMessageId ?? null,
    source_mailbox: mailbox,
    subject: msg.subject ?? null,
    body_html: bodyHtml,
    body_text: bodyText,
    body_preview: msg.bodyPreview ?? null,
    sender_email: senderEmail,
    sender_name: senderName,
    to_recipients: msg.toRecipients ?? [],
    cc_recipients: msg.ccRecipients ?? [],
    has_attachments: !!msg.hasAttachments,
    received_at: msg.receivedDateTime,
    importance: msg.importance ?? null,
    conversation_id: msg.conversationId ?? null,
  }).select("id").single();
  if (insErr) {
    console.error("Insert ticket failed", insErr);
    return;
  }

  await admin.from("ticket_events").insert({
    ticket_id: ticketRow.id,
    order_id: null,
    event_type: "ticket.received",
    actor_type: "customer",
    actor_label: senderEmail,
    summary: msg.subject ?? null,
    payload: { conversation_id: msg.conversationId ?? null },
  }).then(() => {}, () => {});

  // Process attachments — Graph reports hasAttachments=false when only inline
  // images are present, so we always try to fetch.
  await fetchAndStoreAttachments(admin, accessToken, messageId, ticketRow.id);

  // Trigger AI-analyse asynkront (intern service-invokasjon)
  try {
    const analyzeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/analyze-email-with-ai`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // fire-and-forget; ikke await for å ikke blokkere webhook-svaret
    fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-service": serviceKey,
        "apikey": serviceKey,
      },
      body: JSON.stringify({ ticket_id: ticketRow.id }),
    }).catch((err) => console.error("analyze-email-with-ai invoke failed", err));
  } catch (err) {
    console.error("failed to enqueue AI analysis", err);
  }
}

async function fetchAndStoreAttachments(
  admin: ReturnType<typeof createClient>,
  accessToken: string,
  messageId: string,
  ticketId: string,
  /** Settes for vedlegg som kom med en senere melding i tråden. */
  inboundMessageId: string | null = null,
) {
  try {
    const attRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!attRes.ok) {
      console.warn("attachments fetch failed", messageId, attRes.status);
      return;
    }
    const atts = (await attRes.json()).value ?? [];
    for (const a of atts) {
      if (a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;

      // Idempotency: skip if we already have this Graph attachment id for the ticket
      const { data: existing } = await admin
        .from("ticket_attachments")
        .select("id")
        .eq("ticket_id", ticketId)
        .eq("microsoft_attachment_id", a.id)
        .maybeSingle();
      if (existing) continue;

      const sizeBytes = a.size ?? 0;
      let storagePath: string | null = null;
      if (sizeBytes <= MAX_ATTACHMENT_BYTES && a.contentBytes) {
        const bytes = base64ToBytes(a.contentBytes);
        const path = `${ticketId}/${a.id}-${sanitizeFilename(a.name ?? "attachment")}`;
        const up = await admin.storage.from("ticket-attachments").upload(path, bytes, {
          contentType: a.contentType ?? "application/octet-stream",
          upsert: true,
        });
        if (up.error) console.error("Upload failed", up.error);
        else storagePath = path;
      }
      await admin.from("ticket_attachments").insert({
        ticket_id: ticketId,
        microsoft_attachment_id: a.id,
        file_name: a.name ?? "attachment",
        content_type: a.contentType ?? null,
        size_bytes: sizeBytes,
        storage_path: storagePath,
        is_inline: !!a.isInline,
        content_id: a.contentId ?? null,
        ticket_inbound_message_id: inboundMessageId,
      });
    }
  } catch (err) {
    console.error("fetchAndStoreAttachments failed", err);
  }
}


function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 200);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
