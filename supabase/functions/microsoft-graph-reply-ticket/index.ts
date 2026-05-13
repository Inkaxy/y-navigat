// microsoft-graph-reply-ticket: sender et svar på et eksisterende ticket
// (Microsoft Graph melding) via Lovable connector-gateway (Ordrekontoret-tilkobling).
//
// Body: { ticket_id: string, body_html: string, mark_resolved?: boolean }
// Krever innlogget bruker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_outlook";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY mangler" }, 500);
    const MICROSOFT_OUTLOOK_API_KEY = Deno.env.get("MICROSOFT_OUTLOOK_API_KEY");
    if (!MICROSOFT_OUTLOOK_API_KEY) return json({ error: "MICROSOFT_OUTLOOK_API_KEY mangler — koble til Ordrekontoret" }, 500);

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

    const { data: ticket, error: tErr } = await admin
      .from("tickets")
      .select("id, microsoft_message_id, source_mailbox, subject, sender_email")
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

    const mailbox = ticket.source_mailbox || "ordre@nottero-bakeri.no";
    const url = `${GATEWAY_URL}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(ticket.microsoft_message_id)}/reply`;
    const graphRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": MICROSOFT_OUTLOOK_API_KEY,
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
