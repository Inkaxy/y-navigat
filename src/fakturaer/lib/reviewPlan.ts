// ÉN gjennomgangsplan for et varekort (leverandørvare), brukt av både køkortet og det valgte varekortet.
// Bygges bare av serverens lagrede tilstand (review_reason, variance_status, lesevarsler, pakningsstatus,
// prisgrunnlag/rabatt fra rm_supplier_item_lines v2). AI-forslag/confidence gjør aldri et steg grønt.
import { allReasons } from "@/fakturaer/lib/reviewReasons";
import { fmtNum, normalizeUnit } from "@/fakturaer/lib/units";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";

export type StepKey = "kilde" | "vare" | "pakning" | "prisgrunnlag" | "prisavvik" | "kontrollert";
export type StepState = "ok" | "todo" | "unknown";
export const STEP_ORDER: StepKey[] = ["kilde", "vare", "pakning", "prisgrunnlag", "prisavvik", "kontrollert"];
export const STEP_LABEL: Record<StepKey, string> = {
  kilde: "Kilde og tall", vare: "Varegrunnlag", pakning: "Pakning", prisgrunnlag: "Prisgrunnlag", prisavvik: "Prisavvik", kontrollert: "Kontrollert",
};

export interface PlanAction { label: string; step: StepKey; invoiceId: string; lineId: string; invoiceNumber: string | null }
export interface PlanStep { key: StepKey; state: StepState; detail: string; lines: number }
export interface ReviewPlan {
  steps: PlanStep[];
  /** Første steg i fast rekkefølge som ikke er ok. */
  current: PlanStep | null;
  primary: PlanAction | null;
  openLines: number;
  openInvoices: number;
  /** Utvalget kan være avkortet av servergrensen → tellerne er ukjente, ikke komplette. */
  incomplete: boolean;
  /** Linjekontroll ferdig, men fakturaen har egne mangler/godkjenning igjen (vises separat, aldri som ferdig). */
  invoiceFollowUp: { invoiceId: string; invoiceNumber: string | null }[];
}

export interface PlanItem { rm_id: string | null; rm_base_unit: string | null; package_confirmed_at: string | null; base_units_per_package: number | null }

const PKG_RX = /(\d+(?:[.,]\d+)?)\s*(g|gr|kg|ml|cl|dl|l)\b/i;

/** «Bekreft 100 g pose» når linjen er fakturert i en beholder og teksten har innholdet; ellers «Bekreft pakning». */
export function packageActionLabel(l: Pick<SupplierItemLine, "description" | "unit">): string {
  const m = PKG_RX.exec(l.description ?? "");
  const c = normalizeUnit(l.unit) ?? l.unit;
  if (m && c) return `Bekreft ${fmtNum(Number(m[1].replace(",", ".")), 3)} ${m[2].toLowerCase() === "gr" ? "g" : m[2].toLowerCase()} ${c}`;
  return "Bekreft pakning";
}

const hasIssues = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v != null && typeof v === "object" && Object.keys(v).length > 0);

/** Prisgrunnlaget er uavklart: q × pris ≠ sum uten trykt rabatt eller dokumentert grunnlag. */
function basisUnclear(l: SupplierItemLine): boolean | null {
  if (!l.price_context) return null;
  if (l.discount_amount != null && l.discount_amount > 0) return false;
  if (l.unit_price_basis) return false;
  const q = Number(l.quantity), p = Number(l.unit_price), t = Number(l.total_amount);
  if (![q, p, t].every(Number.isFinite)) return null;
  return Math.abs(q * p - t) > Math.max(0.02, Math.abs(t) * 0.0005);
}

type LineStep = { step: StepKey; state: "todo" | "unknown"; label: string };

function lineSteps(l: SupplierItemLine, item: PlanItem): LineStep[] {
  const r = allReasons(l);
  const out: LineStep[] = [];
  if (r.includes("extraction_unresolved") || hasIssues(l.extraction_issues)) out.push({ step: "kilde", state: "todo", label: "Kontroller tallene mot originalen" });
  else if (!l.price_context) out.push({ step: "kilde", state: "unknown", label: "Hent lesegrunnlaget på nytt" });
  if (!l.raw_material_id || r.includes("unmatched") || r.includes("low_confidence") || r.includes("missing_base_unit")) out.push({ step: "vare", state: "todo", label: r.includes("missing_base_unit") ? "Rett varetype og måleenhet" : "Velg råvare" });
  if (r.includes("unknown_package_size") || r.includes("package_conflict")) out.push({ step: "pakning", state: "todo", label: packageActionLabel(l) });
  const b = basisUnclear(l);
  if (b === true) out.push({ step: "prisgrunnlag", state: "todo", label: "Registrer rabatt / avklar prisgrunnlag" });
  else if (b === null && l.requires_review) out.push({ step: "prisgrunnlag", state: "unknown", label: "Avklar prisgrunnlag" });
  if (r.includes("no_baseline") || r.includes("start_price_manual_check")) out.push({ step: "prisavvik", state: "todo", label: "Bekreft første pris" });
  else if (r.some((x) => x === "price_variance" || x === "price_increase" || x === "price_drop" || x === "uncertain_cost" || x === "agreement_conflict" || x === "price_reference_error")) out.push({ step: "prisavvik", state: "todo", label: "Vurder pris" });
  void item;
  return out;
}

export function buildReviewPlan(item: PlanItem, lines: readonly SupplierItemLine[], limit = 200): ReviewPlan {
  const open = lines.filter((l) => l.requires_review);
  // Eldste først: avklaringen starter på eldste gyldige dato.
  const ordered = [...open].sort((a, b) => (a.invoice_date ?? "").localeCompare(b.invoice_date ?? "") || (a.line_number ?? 0) - (b.line_number ?? 0));
  const per = new Map<StepKey, { todo: number; unknown: number; first: { l: SupplierItemLine; label: string } | null }>();
  STEP_ORDER.forEach((k) => per.set(k, { todo: 0, unknown: 0, first: null }));
  for (const l of ordered) {
    for (const s of lineSteps(l, item)) {
      const e = per.get(s.step)!;
      if (s.state === "todo") e.todo += 1; else e.unknown += 1;
      if (!e.first) e.first = { l, label: s.label };
    }
  }
  const steps: PlanStep[] = STEP_ORDER.map((k) => {
    const e = per.get(k)!;
    if (k === "kontrollert") {
      return open.length === 0 ? { key: k, state: "ok", detail: "Ingen åpne linjer", lines: 0 } : { key: k, state: "todo", detail: `${open.length} åpne linjer`, lines: open.length };
    }
    if (e.todo > 0) return { key: k, state: "todo", detail: e.first!.label, lines: e.todo };
    if (e.unknown > 0) return { key: k, state: "unknown", detail: e.first!.label, lines: e.unknown };
    return { key: k, state: "ok", detail: "Ingen mangler", lines: 0 };
  });
  const current = steps.find((s) => s.state !== "ok") ?? null;
  const cur = current && current.key !== "kontrollert" ? per.get(current.key)!.first : ordered[0] ? { l: ordered[0], label: "Kontroller linjen" } : null;
  const primary = current && cur ? { label: cur.label, step: current.key, invoiceId: cur.l.invoice_id, lineId: cur.l.id, invoiceNumber: cur.l.invoice_number ?? null } : null;
  const followUp = new Map<string, { invoiceId: string; invoiceNumber: string | null }>();
  for (const l of lines) {
    if (!l.requires_review && !l.invoice_approved && l.invoice_status && !["reconciled", "excluded"].includes(l.invoice_status)) {
      followUp.set(l.invoice_id, { invoiceId: l.invoice_id, invoiceNumber: l.invoice_number ?? null });
    }
  }
  for (const l of open) followUp.delete(l.invoice_id);
  return {
    steps, current, primary, openLines: open.length, openInvoices: new Set(open.map((l) => l.invoice_id)).size,
    incomplete: lines.length >= limit, invoiceFollowUp: [...followUp.values()],
  };
}

/** Trykt regnestykke med rabatt, f.eks. «10 pose × 977,74 − rabatt 3 079,90 = 6 697,50 (669,75 per pose)». null uten trykt rabatt. */
export function discountArithmeticText(l: Pick<SupplierItemLine, "quantity" | "unit" | "unit_price" | "total_amount" | "discount_amount" | "price_context">): string | null {
  if (!l.price_context || l.discount_amount == null || !(l.discount_amount > 0)) return null;
  const q = Number(l.quantity), p = Number(l.unit_price), t = Number(l.total_amount);
  if (![q, p, t].every(Number.isFinite) || q === 0) return null;
  const nb = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const u = l.unit ?? "";
  return `${fmtNum(q, 3)} ${u} × ${nb(p)} − rabatt ${nb(l.discount_amount)} = ${nb(t)} (netto ${nb(t / q)} per ${u || "enhet"})`.replace(/\s+/g, " ");
}
