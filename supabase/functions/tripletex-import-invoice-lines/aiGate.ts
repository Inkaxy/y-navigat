// Vern rundt AI-tjenesten for linjeimporten:
//  - Før køen tas: feilet forrige kall på tjenesten (nøkkel/kvote/nede), sjekkes tilgangen gratis først
//    (extract-invoice-from-pdf { probe: true }). Feiler sjekken, stoppes kjøringen uten å ta fakturaer,
//    slik at ingen forsøk brukes opp mens nøkkelen er ugyldig.
//  - Etter en tjenestefeil: e-post til Henrik via e-postkøen når lesingen har feilet to ganger på rad,
//    høyst én per døgn for samme feiltype. Sendes bare når malen finnes og er aktiv (PENDING-SQL).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  classifyAiFailure, lastCallFailedSystemically, PROBE_INTERVAL_MS, shouldSendReadingAlert,
  type AiFailure, type UsageLogRow,
} from "../_shared/aiFailure.ts";

type Admin = ReturnType<typeof createClient>;

export const READING_ALERT_TEMPLATE = "invoice_reading_stopped";
/** Mottaker bestemmes av serveren, aldri av kalleren. */
export const READING_ALERT_RECIPIENT = "henrik@nottero-bakeri.no";
const SETTINGS_URL = "https://nbhub.no/ravarer/innstillinger?seksjon=ai";

async function recentUsage(admin: Admin, n = 2): Promise<UsageLogRow[] | null> {
  const { data, error } = await admin.from("ai_usage_log").select("created_at, success, error_message")
    .eq("purpose", "invoice_extraction").order("created_at", { ascending: false }).limit(n);
  if (error) return null;
  return (data ?? []) as UsageLogRow[];
}

export type GateResult = { open: true } | { open: false; failure: AiFailure; probed: boolean };

/** Skal kjøringen ta fakturaer fra køen? Kaster aldri; ukjent loggstatus = åpent (som før). */
export async function aiGate(admin: Admin, supabaseUrl: string, serviceKey: string, legalEntityId: string): Promise<GateResult> {
  const rows = await recentUsage(admin, 1);
  if (!rows) return { open: true };
  const last = lastCallFailedSystemically(rows);
  if (!last) return { open: true };
  // Ny nøkkel/innstilling etter feilen → sjekk med en gang; ellers høyst hvert 30. minutt.
  const { data: cfg } = await admin.from("ai_provider_config").select("updated_at")
    .eq("purpose", "invoice_extraction").eq("is_active", true).maybeSingle();
  const failedAt = Date.parse(rows[0].created_at);
  const cfgChanged = cfg && Date.parse(String((cfg as { updated_at: string }).updated_at)) > failedAt;
  if (!cfgChanged && Number.isFinite(failedAt) && Date.now() - failedAt < PROBE_INTERVAL_MS) {
    return { open: false, failure: last, probed: false };
  }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/extract-invoice-from-pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ legal_entity_id: legalEntityId, probe: true }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json().catch(() => null) as { ai_status?: string; ai_failure?: AiFailure | null } | null;
    // Eldre leser uten probe-støtte svarer 400: da prøves vanlig lesing (som før).
    if (!res.ok || !j || typeof j.ai_status !== "string") return { open: true };
    if (j.ai_status === "ok") return { open: true };
    const failure = j.ai_failure && typeof j.ai_failure.message === "string" ? j.ai_failure : last;
    await admin.from("ai_usage_log").insert({
      provider: failure.provider ?? "ukjent", model: "forhandssjekk", purpose: "invoice_extraction",
      legal_entity_id: legalEntityId, success: false, error_message: `Forhåndssjekk: ${failure.message}`,
    });
    return { open: false, failure, probed: true };
  } catch (e) {
    return { open: false, failure: classifyAiFailure(e), probed: true };
  }
}

const osloTime = (iso: string | null) => (iso ? new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "ukjent");

/** Legger varsel-e-post i køen når regelen sier det. Feil her skal aldri velte importen. */
export async function maybeQueueReadingAlert(admin: Admin): Promise<"queued" | "skipped" | "no_template"> {
  try {
    const rows = await recentUsage(admin, 2);
    if (!rows) return "skipped";
    const { data: last } = await admin.from("email_outbox").select("created_at, variables")
      .eq("template_key", READING_ALERT_TEMPLATE).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const lastAlert = last ? { created_at: String((last as { created_at: string }).created_at), kind: String(((last as { variables: Record<string, unknown> | null }).variables ?? {}).feiltype ?? "") || null } : null;
    const failure = shouldSendReadingAlert(rows, lastAlert, Date.now());
    if (!failure) return "skipped";
    const { data: tpl } = await admin.from("email_templates").select("is_active").eq("template_key", READING_ALERT_TEMPLATE).maybeSingle();
    if (!tpl || (tpl as { is_active: boolean }).is_active !== true) return "no_template";
    const { data: ok } = await admin.from("ai_usage_log").select("created_at")
      .eq("purpose", "invoice_extraction").eq("success", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { error } = await admin.from("email_outbox").insert({
      template_key: READING_ALERT_TEMPLATE,
      recipient_email: READING_ALERT_RECIPIENT,
      related_entity_type: "invoice_reading_alert",
      variables: {
        feiltype: failure.kind,
        feilmelding: failure.message,
        siste_vellykkede: osloTime(ok ? String((ok as { created_at: string }).created_at) : null),
        tidspunkt: osloTime(new Date().toISOString()),
        lenke: SETTINGS_URL,
      },
    });
    if (error) { console.error("lesevarsel", error.message); return "skipped"; }
    return "queued";
  } catch (e) {
    console.error("lesevarsel", e instanceof Error ? e.message : String(e));
    return "skipped";
  }
}
