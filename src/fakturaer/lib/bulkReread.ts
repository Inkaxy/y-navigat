// «Les på nytt i bolk» (rettepakke 13.11.2026, punkt I). Ren logikk (testes).
//
// Tre grupper, hver med eksisterende skrivevei:
//  1 uten_linjer      – «PDF-en ga ingen lesbare linjer» etter at nøkkelen sluttet å virke. Legges tilbake i
//                       den vanlige lesekøen (rm_requeue_invoice_line_extraction, PENDING-SQL). Fakturaer med
//                       linjer, rettelser, ført kost, godkjenning eller avstemming hoppes over av serveren.
//  2 gamle_avvik      – sumavvik lest før nytt forsøk fantes (forsøk = 0). Dagens «Les på nytt» per faktura:
//                       gir bare FORSLAG. Henrik går gjennom og tar i bruk per faktura; manuelt rettede/koblede
//                       linjer krever eksplisitt overstyring der, så ingenting overskrives i bolk.
//  3 ikke_kontrollert – linjer uten sumkontroll. Bare sumkontroll (ingen AI, ingen linjer endres).
export type BulkGroup = "uten_linjer" | "gamle_avvik" | "ikke_kontrollert";

export const BULK_GROUP_LABEL: Record<BulkGroup, string> = {
  uten_linjer: "Uten linjer siden nøkkelen sluttet å virke",
  gamle_avvik: "Gamle sumavvik (lest før nytt forsøk fantes)",
  ikke_kontrollert: "Ikke sumkontrollert",
};

/** Første fakturadato som ble lest uten linjer da nøkkelen sluttet å virke (målt 13.11.2026). */
export const DEFAULT_NO_LINES_SINCE = "2026-10-19";
export const NO_LINES_ERROR = "PDF-en ga ingen lesbare linjer";

export interface UsageCostRow { invoice_id: string | null; estimated_cost_usd: number | string | null; success: boolean }
export interface CostEstimate { perInvoiceUsd: number | null; totalUsd: number | null; basisInvoices: number }

/**
 * Omtrentlig kostnad: snitt av loggført kostnad per faktura (alle vellykkede kall for samme faktura summert),
 * ganget med antall. Ukjent når loggen ikke kan leses eller har for få fakturaer (minst 3). Aldri 0 som gjetning.
 */
export function estimateCost(rows: readonly UsageCostRow[] | null, invoices: number, readsPerInvoice = 1): CostEstimate {
  if (!rows) return { perInvoiceUsd: null, totalUsd: null, basisInvoices: 0 };
  const per = new Map<string, number>();
  for (const r of rows) {
    if (!r.success || !r.invoice_id) continue;
    const c = Number(r.estimated_cost_usd);
    if (!Number.isFinite(c) || c < 0) continue;
    per.set(r.invoice_id, (per.get(r.invoice_id) ?? 0) + c);
  }
  if (per.size < 3) return { perInvoiceUsd: null, totalUsd: null, basisInvoices: per.size };
  const avg = [...per.values()].reduce((s, v) => s + v, 0) / per.size;
  return { perInvoiceUsd: avg, totalUsd: avg * invoices * readsPerInvoice, basisInvoices: per.size };
}

export function fmtUsd(v: number | null): string {
  if (v == null) return "ukjent";
  return `ca. ${v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

/** Utfall per faktura i gruppe 2. Koder fra rm_begin_invoice_reread / reread-invoice-preview. */
export type StepOutcome = "forslag" | "hoppet_over" | "feilet" | "ai_feil" | "ukjent";

const SKIP_CODES = new Set(["faktura_last", "faktura_flagget", "faktura_godkjent", "kostpris_fort", "dokument_mangler", "ikke_pdf", "pagaende"]);

export function classifyStep(begin: { ok: boolean; code?: string | null }, preview: { code: string | null } | null): StepOutcome {
  if (!begin.ok) return SKIP_CODES.has(begin.code ?? "") ? "hoppet_over" : "feilet";
  if (!preview) return "ukjent";
  const c = preview.code;
  if (c == null) return "forslag";
  if (c === "ai_feil" || c === "ai_feil_nokkel") return "ai_feil";
  if (c === "ukjent_utfall") return "ukjent";
  return "feilet";
}

export interface SequentialProgress { done: number; total: number; stopped: "ai_feil" | "avbrutt" | null }

/**
 * Kjører ett steg om gangen. Stopper ved første AI-feil (tjenesten virker ikke – resten ville også feilet)
 * eller når signalet avbrytes (pågående steg fullføres, ingen nye startes).
 */
export async function runSequential<T>(
  items: readonly T[], step: (item: T) => Promise<StepOutcome>,
  opts: { signal?: AbortSignal; onStep?: (item: T, outcome: StepOutcome, p: SequentialProgress) => void } = {},
): Promise<SequentialProgress> {
  const p: SequentialProgress = { done: 0, total: items.length, stopped: null };
  for (const item of items) {
    if (opts.signal?.aborted) { p.stopped = "avbrutt"; break; }
    const outcome = await step(item);
    p.done++;
    opts.onStep?.(item, outcome, { ...p });
    if (outcome === "ai_feil") { p.stopped = "ai_feil"; break; }
  }
  return p;
}

/** Svar fra rm_requeue_invoice_line_extraction, strengt lest. null = ukjent svar. */
export function parseRequeueResult(d: unknown): { requeued: number; skipped: { invoice_id: string; reason: string }[] } | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  if (o.ok !== true || typeof o.requeued !== "number" || !Array.isArray(o.skipped)) return null;
  const skipped: { invoice_id: string; reason: string }[] = [];
  for (const s of o.skipped) {
    if (!s || typeof s !== "object") return null;
    const r = s as Record<string, unknown>;
    if (typeof r.invoice_id !== "string" || typeof r.reason !== "string") return null;
    skipped.push({ invoice_id: r.invoice_id, reason: r.reason });
  }
  return { requeued: o.requeued, skipped };
}
