// Re-fetches Outlook/Graph attachments for an existing ticket and stores them
// in ticket_attachments (idempotent per microsoft_attachment_id).
// Used to backfill inline images (cid:...) that Graph didn't flag as hasAttachments
// on the original webhook delivery.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, encryptToken, refreshAccessToken } from "../_shared/m365-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { ticket_id } = await req.json();
    if (!ticket_id) return json({ error: "ticket_id påkrevd" }, 400);

    // RLS-check via user client, then admin for actual work.
    const { data: ticket, error: tErr } = await userClient
      .from("tickets")
      .select("id, microsoft_message_id")
      .eq("id", ticket_id)
      .maybeSingle();
    if (tErr) return json({ error: tErr.message }, 500);
    if (!ticket?.microsoft_message_id) {
      return json({ error: "Ticket har ingen microsoft_message_id" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Refresh access token if needed
    const tenantId = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")!;
    const { data: tokenRow } = await admin.from("microsoft_oauth_tokens")
      .select("id, access_token_encrypted, refresh_token_encrypted, expires_at")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!tokenRow) return json({ error: "Ingen M365-token konfigurert" }, 500);
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

    // Fetch attachments for the original message + all inbound messages on this ticket
    const messageIds = new Set<string>([ticket.microsoft_message_id]);
    const { data: inbounds } = await admin
      .from("ticket_inbound_messages")
      .select("microsoft_message_id")
      .eq("ticket_id", ticket_id);
    for (const r of inbounds ?? []) {
      if (r.microsoft_message_id) messageIds.add(r.microsoft_message_id);
    }

    let inserted = 0;
    for (const mid of messageIds) {
      const attRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${mid}/attachments`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!attRes.ok) continue;
      const atts = (await attRes.json()).value ?? [];
      for (const a of atts) {
        if (a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;

        const { data: existing } = await admin
          .from("ticket_attachments")
          .select("id")
          .eq("ticket_id", ticket_id)
          .eq("microsoft_attachment_id", a.id)
          .maybeSingle();
        if (existing) continue;

        const sizeBytes = a.size ?? 0;
        let storagePath: string | null = null;
        if (sizeBytes <= MAX_ATTACHMENT_BYTES && a.contentBytes) {
          const bytes = base64ToBytes(a.contentBytes);
          const path = `${ticket_id}/${a.id}-${sanitizeFilename(a.name ?? "attachment")}`;
          const up = await admin.storage.from("ticket-attachments").upload(path, bytes, {
            contentType: a.contentType ?? "application/octet-stream",
            upsert: true,
          });
          if (!up.error) storagePath = path;
        }
        await admin.from("ticket_attachments").insert({
          ticket_id,
          microsoft_attachment_id: a.id,
          file_name: a.name ?? "attachment",
          content_type: a.contentType ?? null,
          size_bytes: sizeBytes,
          storage_path: storagePath,
          is_inline: !!a.isInline,
          content_id: a.contentId ?? null,
        });
        inserted++;
      }
    }

    return json({ ok: true, inserted });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
