/**
 * Felles økonomisk presentasjon på fakturaer. Om en prissammenligning kan vises avgjøres ALDRI her,
 * men av serverens `rm_invoice_line_price_safety` (se `priceSafety.ts`). Originalbeløp vises alltid i
 * dokumentets egen valuta og med sitt fortegn — aldri «rettet».
 */
import type { LineSafety } from "./priceSafety";

export type ActionRequired =
  | "review_credit_note"
  | "review_currency"
  | "confirm_price_basis"
  | "review_reading"
  | "complete_link_or_package"
  | "review_price"
  | "review_invoice";

export type PriceGate =
  | { ok: true; safety: LineSafety }
  | { ok: false; reason: string; action: ActionRequired; label: string; detail: string };

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(Number(v));

export const ACTION_COPY: Record<ActionRequired, { label: string; detail: string }> = {
  review_credit_note: { label: "Kontroller kreditnotaen", detail: "En kreditnota er ikke en prisendring. Koble den til opprinnelig faktura; beløpet vises som på dokumentet." },
  review_currency: { label: "Kontroller valuta", detail: "Fakturaen er ikke i NOK. Beløpene vises i dokumentets valuta og sammenlignes ikke med kronepriser." },
  confirm_price_basis: { label: "Bekreft prisgrunnlaget", detail: "Prisgrunnlaget er ikke dokumentert eller er holdt tilbake. Prisvirkning beregnes ikke før det er bekreftet." },
  review_reading: { label: "Kontroller lesingen", detail: "Tallene er ikke kontrollert mot originalen eller fakturasummen. Prisvirkning beregnes ikke ennå." },
  complete_link_or_package: { label: "Fullfør kobling eller pakning", detail: "Linjen mangler sikker kobling, mengde eller pakning. Prisvirkning beregnes ikke ennå." },
  review_price: { label: "Vurder prisen", detail: "Prisen avviker fra dokumentert sammenligningspris." },
  review_invoice: { label: "Kontroller fakturaen", detail: "Fakturaen må kontrolleres. Fakturabeløpet er ikke en prisvirkning." },
};

export function isNok(currency: string | null | undefined): boolean {
  return (currency ?? "").trim().toUpperCase() === "NOK";
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
