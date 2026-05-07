// process-email-outbox (B.1): Drainer email_outbox-tabellen.
// - Henter pending-rader (max 20 per kjøring)
// - Kaller microsoft-graph-send med service-role-token
// - Oppdaterer status (sent / failed) + attempt_count
// - Failed-rader med attempt_count >= 5 forblir failed (ikke re-prøvd)
//
// Tenkt kjørt periodisk via pg_cron — Henrik aktiverer separat.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BATCH = 20;
const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: rows, error } = await admin
      .from("email_outbox")
      .select("id, template_key, recipient_email, variables, attempt_count")
      .eq("status", "pending")
      .lt("attempt_count", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH);
    if (error) throw new Error(`Kunne ikke lese outbox: ${error.message}`);

    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const row of rows ?? []) {
      const newAttempt = (row.attempt_count ?? 0) + 1;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/microsoft-graph-send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            template_key: row.template_key,
            recipient_email: row.recipient_email,
            variables: row.variables ?? {},
          }),
        });
        const txt = await res.text();
        if (!res.ok) {
          throw new Error(`graph-send returnerte ${res.status}: ${txt}`);
        }
        const parsed = JSON.parse(txt);
        if (!parsed.success) {
          throw new Error(parsed.error ?? "Ukjent feil fra graph-send");
        }
        await admin
          .from("email_outbox")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempt_count: newAttempt,
            last_attempt_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", row.id);
        results.push({ id: row.id, status: "sent" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isFinal = newAttempt >= MAX_ATTEMPTS;
        await admin
          .from("email_outbox")
          .update({
            status: isFinal ? "failed" : "pending",
            attempt_count: newAttempt,
            last_attempt_at: new Date().toISOString(),
            error_message: msg.slice(0, 500),
          })
          .eq("id", row.id);
        results.push({ id: row.id, status: isFinal ? "failed" : "retry", error: msg });
      }
    }

    return json({ processed: results.length, results });
  } catch (e) {
    console.error("process-email-outbox error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
