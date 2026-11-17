// Samlet gjenlesing: hvem som leses, hvem som hoppes over (og hvorfor), og grovt kostnadsanslag.
// Ren logikk (testes). Ingenting her endrer data.
import { osloDateISO } from "@/lib/osloDate";

export type SkipReason = "last" | "godkjent" | "kostpris_fort" | "mangler_pdf" | "i_lesekoen" | "uten_linjer" | "lesing_venter" | "lest_i_dag";
export const SKIP_ORDER: SkipReason[] = ["godkjent", "kostpris_fort", "last", "mangler_pdf", "lest_i_dag", "uten_linjer", "i_lesekoen", "lesing_venter"];
export const SKIP_LABEL: Record<SkipReason, string> = {
  godkjent: "Godkjent internt",
  kostpris_fort: "Kostpris er ført",
  last: "Avstemt, flagget eller låst",
  mangler_pdf: "Mangler PDF",
  lest_i_dag: "Lest i dag, og summen stemmer",
  uten_linjer: "Uten linjer (bruk «Les alle på nytt» i gruppen «Ikke lest» – den vanlige lesekøen)",
  i_lesekoen: "Står i lesekøen nå",
  lesing_venter: "Har allerede en lesing som pågår eller venter",
};

export interface PlanInvoice {
  id: string; invoice_number: string | null; invoice_date: string | null; supplier_id: string | null; total_amount: number | null;
  status: string | null; reconciled_at: string | null; flagged_at: string | null; source_document_url: string | null;
  lines_sum_status: string | null; line_extraction_status: string | null; line_extraction_at: string | null;
  line_count: number; approved: boolean; costPosted: boolean; openRun: boolean; rereadAppliedAt: string | null;
}

const OPEN = ["imported", "needs_review", "ready"];

/** Første grunn som gjelder, i fast rekkefølge (samme sperrer som serverens _rm_reread_blocker først). null = leses. */
export function skipReason(i: PlanInvoice, todayIso: string): SkipReason | null {
  if (i.approved) return "godkjent";
  if (i.costPosted) return "kostpris_fort";
  if (!i.status || !OPEN.includes(i.status) || i.reconciled_at || i.flagged_at) return "last";
  if (!i.source_document_url) return "mangler_pdf";
  const readToday = [i.line_extraction_at, i.rereadAppliedAt].some((t) => !!t && osloDateISO(t) === todayIso);
  if (readToday && i.lines_sum_status === "ok") return "lest_i_dag";
  if (i.line_count === 0) return "uten_linjer";
  if (i.line_extraction_status === "pending" || i.line_extraction_status === "processing") return "i_lesekoen";
  if (i.openRun) return "lesing_venter";
  return null;
}

export interface RunPlan {
  total: number;
  read: PlanInvoice[];
  skipped: Record<SkipReason, number>;
}

/** Eldste først (fakturadato, så id) – samme rekkefølge som resten av Råvarer. */
export function buildPlan(invoices: readonly PlanInvoice[], todayIso: string): RunPlan {
  const skipped = Object.fromEntries(SKIP_ORDER.map((r) => [r, 0])) as Record<SkipReason, number>;
  const read: PlanInvoice[] = [];
  for (const i of invoices) {
    const r = skipReason(i, todayIso);
    if (r) skipped[r]++; else read.push(i);
  }
  read.sort((a, b) => (a.invoice_date ?? "9999").localeCompare(b.invoice_date ?? "9999") || a.id.localeCompare(b.id));
  return { total: invoices.length, read, skipped };
}

export interface UsageRow { model: string | null; estimated_cost_usd: number | string | null; success: boolean }
export interface RunCost { model: string | null; modelMatched: boolean; perReadUsd: number | null; totalUsd: number | null; maxUsd: number | null; basis: number }

/**
 * Grovt anslag: snitt av loggført kostnad per vellykket lesing med aktiv modell, ganget med antall.
 * «Inntil» regner med ett nytt forsøk på hver femte faktura. Har aktiv modell færre enn 3 loggførte lesinger,
 * brukes alle modeller og det sies tydelig. Ukjent logg = ukjent, aldri 0.
 */
export function estimateRunCost(rows: readonly UsageRow[] | null, activeModel: string | null, invoices: number): RunCost {
  const valid = (rows ?? []).flatMap((r) => {
    const c = Number(r.estimated_cost_usd);
    return r.success && r.estimated_cost_usd != null && Number.isFinite(c) && c >= 0 ? [{ model: r.model, c }] : [];
  });
  const sameModel = activeModel ? valid.filter((r) => r.model === activeModel) : [];
  const basisRows = sameModel.length >= 3 ? sameModel : valid;
  const model = activeModel ?? null;
  if (!rows || basisRows.length < 3) return { model, modelMatched: false, perReadUsd: null, totalUsd: null, maxUsd: null, basis: basisRows.length };
  const avg = basisRows.reduce((s, r) => s + r.c, 0) / basisRows.length;
  return { model, modelMatched: sameModel.length >= 3, perReadUsd: avg, totalUsd: avg * invoices, maxUsd: avg * invoices * 1.2, basis: basisRows.length };
}

export const usd = (v: number | null): string =>
  v == null ? "ukjent" : `${v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
