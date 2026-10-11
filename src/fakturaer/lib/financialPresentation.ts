/**
 * ÉN presentasjonsregel for økonomiske påstander på fakturalinjer.
 *
 * Speiler rekkefølgen i serverens `_rm_queue_line_read_issue` (live, se
 * supabase/live-mirror/ravarer_queue_verified_effects.md): en prissammenligning
 * (prosent, kronevirkning, «Prisen er riktig») vises bare når fakturaen og linjen
 * har dokumentert grunnlag. Ellers vises en kontrolloppgave. Originalbeløpene
 * vises alltid i dokumentets egen valuta og med sitt fortegn — aldri «rettet».
 */
import { parseReadIssues } from "@/fakturaer/lib/lineCorrection";

export type GateReason =
  | "price_observation_held"
  | "missing_link"
  | "credit_note"
  | "non_nok_currency"
  | "invoice_read_unverified"
  | "line_read_issue"
  | "line_arithmetic_unverified"
  | "invoice_sum_not_verified"
  | "invalid_quantity"
  | "missing_reference"
  | "hold_unknown";

export type ActionRequired =
  | "review_credit_note"
  | "review_currency"
  | "confirm_price_basis"
  | "review_reading"
  | "complete_link_or_package"
  | "review_price"
  | "review_invoice";

export type PriceGate =
  | { ok: true }
  | { ok: false; reason: GateReason; action: ActionRequired; label: string; detail: string };

export interface GateInvoice {
  is_credit_note?: boolean | null;
  currency?: string | null;
  lines_sum_status?: string | null;
  flagged_at?: string | null;
  extraction_issues?: unknown;
  status?: string | null;
}
export interface GateLine {
  total_amount?: number | null;
  quantity?: number | null;
  base_quantity?: number | null;
  price_per_base_unit?: number | null;
  expected_price_per_base_unit?: number | null;
  raw_material_id?: string | null;
  extraction_issues?: unknown;
}
/** `true` = åpen prisobservasjon holdt tilbake; `null` = ukjent (ikke lastet / ikke tilgjengelig). */
export type HoldState = boolean | null | undefined;

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(Number(v));
const pos = (v: number | null | undefined) => fin(v) && Number(v) > 0;

export const ACTION_COPY: Record<ActionRequired, { label: string; detail: string }> = {
  review_credit_note: { label: "Kontroller kreditnotaen", detail: "En kreditnota er ikke en prisendring. Koble den til opprinnelig faktura; beløpet vises som på dokumentet." },
  review_currency: { label: "Kontroller valuta", detail: "Fakturaen er ikke i NOK. Beløpene vises i dokumentets valuta og sammenlignes ikke med kronepriser." },
  confirm_price_basis: { label: "Bekreft prisgrunnlaget", detail: "Prisgrunnlaget er ikke dokumentert eller er holdt tilbake. Prisvirkning beregnes ikke før det er bekreftet." },
  review_reading: { label: "Kontroller lesingen", detail: "Tallene er ikke kontrollert mot originalen eller fakturasummen. Prisvirkning beregnes ikke ennå." },
  complete_link_or_package: { label: "Fullfør kobling eller pakning", detail: "Linjen mangler sikker kobling, mengde eller pakning. Prisvirkning beregnes ikke ennå." },
  review_price: { label: "Vurder prisen", detail: "Prisen avviker fra dokumentert sammenligningspris." },
  review_invoice: { label: "Kontroller fakturaen", detail: "Fakturaen må kontrolleres. Fakturabeløpet er ikke en prisvirkning." },
};

const block = (reason: GateReason, action: ActionRequired, detail?: string): PriceGate => ({
  ok: false, reason, action, label: ACTION_COPY[action].label, detail: detail ?? ACTION_COPY[action].detail,
});

export function isNok(currency: string | null | undefined): boolean {
  return (currency ?? "").trim().toUpperCase() === "NOK";
}

/** Kan en prissammenligning for linjen vises? Første treff vinner, samme rekkefølge som serveren. */
export function linePriceGate(inv: GateInvoice, line: GateLine, held?: HoldState): PriceGate {
  if (held === true) return block("price_observation_held", "confirm_price_basis");
  if (!line.raw_material_id) return block("missing_link", "complete_link_or_package");
  if (inv.is_credit_note) return block("credit_note", "review_credit_note");
  if (!isNok(inv.currency)) return block("non_nok_currency", "review_currency");
  if (inv.flagged_at || parseReadIssues(inv.extraction_issues).length > 0) return block("invoice_read_unverified", "review_reading");
  if (parseReadIssues(line.extraction_issues).length > 0) return block("line_read_issue", "review_reading");
  const t = line.total_amount, p = line.price_per_base_unit, q = line.base_quantity;
  if (!pos(t) || !pos(p) || !fin(q) || Math.abs(Number(p) * Number(q) - Number(t)) > Math.max(0.05, 0.01 * Number(t))) {
    return block("line_arithmetic_unverified", "review_reading");
  }
  if ((inv.lines_sum_status ?? "") !== "ok") return block("invoice_sum_not_verified", "review_reading");
  if (!pos(line.quantity) || !pos(q)) return block("invalid_quantity", "complete_link_or_package");
  if (!pos(line.expected_price_per_base_unit)) return block("missing_reference", "confirm_price_basis");
  if (held == null) return block("hold_unknown", "confirm_price_basis", "Om prisobservasjonen er holdt tilbake er ikke kjent her. Åpne leverandørvaren for å se prisgrunnlaget.");
  return { ok: true };
}

/** Kontrolltall for fakturaen. Bare eksplisitt mva = 0 betyr avgiftsfritt; ukjent mva gir ukjent netto. */
export type InvoiceFigures = { currency: string; gross: number | null; vat: number | null; net: number | null; linesSum: number | null; diff: number | null };
export function invoiceFigures(d: { total_amount?: number | null; total_vat?: number | null; lines_sum_excl_vat?: number | null; currency?: string | null }): InvoiceFigures {
  const gross = fin(d.total_amount) ? Number(d.total_amount) : null;
  const vat = fin(d.total_vat) ? Number(d.total_vat) : null;
  const net = gross != null && vat != null ? Math.round((gross - vat) * 100) / 100 : null;
  const linesSum = fin(d.lines_sum_excl_vat) ? Number(d.lines_sum_excl_vat) : null;
  return {
    currency: (d.currency ?? "NOK").trim().toUpperCase() || "NOK",
    gross, vat, net, linesSum,
    diff: net != null && linesSum != null ? Math.round((linesSum - net) * 100) / 100 : null,
  };
}

/** Kildetekst styrt av faktisk kilde — aldri «Tripletex» for manuelt importert PDF. */
export function invoiceSourceLabel(d: { source?: string | null; tripletex_supplier_invoice_id?: string | number | null; imported_from_tripletex_at?: string | null }): string {
  const s = (d.source ?? "").toLowerCase();
  if (s.includes("tripletex") || (!s && (d.tripletex_supplier_invoice_id != null || d.imported_from_tripletex_at))) return "Fra Tripletex";
  if (s.includes("pdf") || s.includes("manual")) return "Fra manuelt importert PDF";
  if (s.includes("ehf")) return "Fra EHF";
  return "Fra fakturahodet";
}

const ACTIONS: readonly ActionRequired[] = ["review_credit_note", "review_currency", "confirm_price_basis", "review_reading", "complete_link_or_package", "review_price", "review_invoice"];
export function toActionRequired(v: unknown): ActionRequired | null {
  return typeof v === "string" && (ACTIONS as readonly string[]).includes(v) ? (v as ActionRequired) : null;
}
