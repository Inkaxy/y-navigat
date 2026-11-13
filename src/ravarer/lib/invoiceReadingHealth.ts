// Står fakturalesingen stille fordi AI-tjenesten feiler? Ren logikk (testes).
//
// Kilde 1 (plattformadministrator): bruksloggen for fakturalesing — siste kall feilet på tjenesten
//   (nøkkel/kvote/nede/nettverk/oppsett), med tidspunkt for når feilingen startet.
// Kilde 2 (alle med fakturatilgang): fakturaer som venter med AI-feiltekst (AI_FAILURE_PREFIX).
// Ukjent ≠ ok: lesefeil gir «unknown», som ikke viser varsel men heller ikke sier at alt virker.
import { classifyAiFailure, isAiFailureText, type AiFailure, type UsageLogRow } from "@/fakturaer/lib/aiFailure";

export interface InvoiceAiErrorRow { line_extraction_error: string | null; line_extraction_at: string | null }

export type ReadingHealth =
  | { state: "unknown" }
  | { state: "ok" }
  | {
      state: "failing";
      failure: AiFailure;
      /** Første feil i den sammenhengende rekken (null = ukjent). */
      failingSince: string | null;
      /** Siste vellykkede lesing (null = ingen kjent). */
      lastSuccessAt: string | null;
      /** Antall feilede kall i rekken (bare fra bruksloggen). */
      failedCalls: number | null;
      waitingInvoices: number | null;
    };

export interface ReadingHealthInput {
  /** Nyeste først. null = kunne ikke leses. Tom = ingen rader eller ingen tilgang. */
  usage: readonly UsageLogRow[] | null;
  lastSuccessAt: string | null;
  /** Fakturaer som venter med AI-feiltekst, nyeste først. null = kunne ikke leses. */
  aiErrorInvoices: readonly InvoiceAiErrorRow[] | null;
}

export function invoiceReadingHealth(i: ReadingHealthInput): ReadingHealth {
  const waiting = i.aiErrorInvoices ? i.aiErrorInvoices.filter((r) => isAiFailureText(r.line_extraction_error)) : null;
  if (i.usage && i.usage.length > 0) {
    const head = i.usage[0];
    if (head.success) return { state: "ok" };
    const failure = classifyAiFailure(head.error_message ?? "");
    if (!failure.systemic) return { state: "ok" };
    let n = 0;
    let since: string | null = null;
    for (const r of i.usage) {
      if (r.success) break;
      n++;
      since = r.created_at;
    }
    return { state: "failing", failure, failingSince: since, lastSuccessAt: i.lastSuccessAt, failedCalls: n, waitingInvoices: waiting?.length ?? null };
  }
  if (waiting === null) return { state: "unknown" };
  // Ingen ventende AI-feil i fakturaene. Uten lesbar logg vet vi likevel ikke at tjenesten virker.
  if (waiting.length === 0) return i.usage === null ? { state: "unknown" } : { state: "ok" };
  const newest = waiting[0];
  const oldest = waiting[waiting.length - 1];
  return {
    state: "failing",
    failure: classifyAiFailure((newest.line_extraction_error ?? "").replace(/^Forsøk \d+\/\d+:\s*/, "")),
    failingSince: oldest.line_extraction_at,
    lastSuccessAt: i.lastSuccessAt,
    failedCalls: null,
    waitingInvoices: waiting.length,
  };
}

const OSLO = new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** Absolutt norsk tid (Oslo), «ukjent» for manglende/ugyldig. */
export function fmtOsloDateTime(iso: string | null): string {
  if (!iso) return "ukjent";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "ukjent" : OSLO.format(d);
}
