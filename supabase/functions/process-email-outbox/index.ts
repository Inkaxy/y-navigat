// process-email-outbox: drainer email_outbox.
// - Krever service-bearer eller X-Cron-Secret (verify_cron_secret). Ingen anonyme kall.
// - Rader tas ut atomisk (claim_email_outbox_batch/_one: bare status «pending», attempt_count økes ved claim)
//   FØR utsending — sendte rader kan ikke spilles av på nytt, og samtidige kjøringer tar ikke samme rad.
// - Leverandørutsending skjer utenfor databasetransaksjonen.
// - Ukjent leveringsutfall (nettverksfeil/timeout etter at forespørselen kan ha nådd fram) → «failed»
//   med forklaring, ikke ny automatisk sending (unngår duplikater). Det gjelder også 5xx og 2xx uten gyldig
//   bekreftelse. Kjent avvisning før sending (4xx) → nytt forsøk.
import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeCron, CRON_CORS_HEADERS } from "../_shared/cron-auth.ts";
import { classifyGraphSendResponse, UNKNOWN_NOTE } from "../_shared/outboxOutcome.ts";

const MAX_BATCH = 20;
const MAX_ATTEMPTS = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; template_key: string; recipient_email: string; variables: Record<string, unknown> | null; attempt_count: number };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CRON_CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CRON_CORS_HEADERS });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, serviceKey);

  const who = await authorizeCron(req, admin);
  if (!who) return json({ error: "unauthorized" }, 401);

  try {
    let outboxId: string | null = null;
    if (req.method === "POST") {
      const text = await req.text();
      if (text.trim()) {
        let body: unknown;
        try { body = JSON.parse(text); } catch { return json({ error: "ugyldig JSON" }, 400); }
        const v = body && typeof body === "object" && "outbox_id" in body ? (body as { outbox_id: unknown }).outbox_id : null;
        if (v != null) {
          if (typeof v !== "string" || !UUID_RE.test(v)) return json({ error: "ugyldig outbox_id" }, 400);
          outboxId = v;
        }
      }
    }

    const claim = outboxId
      ? await admin.rpc("claim_email_outbox_one", { p_id: outboxId })
      : await admin.rpc("claim_email_outbox_batch", { p_limit: MAX_BATCH });
    if (claim.error) throw new Error(`Kunne ikke ta ut e-post fra køen: ${claim.error.message}`);
    const rows = (claim.data ?? []) as Row[];

    const results: Array<{ outbox_id: string; status: string; error?: string }> = [];
    for (const row of rows) {
      let res: Response;
      try {
        res = await fetch(`${supabaseUrl}/functions/v1/microsoft-graph-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ template_key: row.template_key, recipient_email: row.recipient_email, variables: row.variables ?? {} }),
          signal: AbortSignal.timeout(45_000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await admin.from("email_outbox").update({
          status: "failed",
          error_message: `${UNKNOWN_NOTE} (${msg.slice(0, 200)})`,
        }).eq("id", row.id).eq("status", "sending");
        results.push({ outbox_id: row.id, status: "unknown", error: "ukjent leveringsutfall" });
        continue;
      }
      const txt = await res.text().catch(() => "");
      const outcome = classifyGraphSendResponse(res.status, txt);
      if (outcome.kind === "sent") {
        await admin.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
          .eq("id", row.id).eq("status", "sending");
        results.push({ outbox_id: row.id, status: "sent" });
      } else if (outcome.kind === "unknown") {
        await admin.from("email_outbox").update({ status: "failed", error_message: outcome.error.slice(0, 500) })
          .eq("id", row.id).eq("status", "sending");
        results.push({ outbox_id: row.id, status: "unknown", error: "ukjent leveringsutfall" });
      } else {
        const isFinal = row.attempt_count >= MAX_ATTEMPTS;
        await admin.from("email_outbox").update({ status: isFinal ? "failed" : "pending", error_message: outcome.error.slice(0, 500) })
          .eq("id", row.id).eq("status", "sending");
        results.push({ outbox_id: row.id, status: isFinal ? "failed" : "retry", error: outcome.error });
      }
    }
    return json({ processed: results.length, results });
  } catch (e) {
    console.error("process-email-outbox error", e);
    return json({ error: "Køen kunne ikke behandles" }, 500);
  }
});
