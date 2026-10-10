import { formatDate } from "@/fakturaer/lib/constants";
import type { PriceRefSource, PriceReference } from "@/fakturaer/lib/parseRpcJson";

export const PRICE_REFERENCE_LABEL: Record<PriceRefSource, string> = {
  agreement: "Avtalepris",
  start_price: "Startpris",
  last_purchase: "Siste kjøp",
  conflict: "To likestilte avtaler — konflikt",
  none: "Ingen prisgrunnlag",
};

export const priceReferenceLabel = (s: PriceRefSource) => PRICE_REFERENCE_LABEL[s];

/** «gjelder fra 1. jan. 2026» / «siste kjøp 3. okt. 2026». */
export function priceReferenceDateText(r: Pick<PriceReference, "source" | "reference_date">): string | null {
  if (!r.reference_date) return null;
  const d = formatDate(r.reference_date);
  if (r.source === "last_purchase") return `siste kjøp ${d}`;
  if (r.source === "agreement" || r.source === "start_price") return `gjelder fra ${d}`;
  return null;
}

/** Kildeetikett for `invoice_lines.price_reference_source`. */
export function lineReferenceLabel(s: string | null | undefined): string {
  switch (s) {
    case "agreement": return "avtale";
    case "start_price": return "startpris";
    case "last_purchase": return "siste kjøp";
    default: return "—";
  }
}

/** Pen tekst for `superseded_reason` på prisobservasjoner. */
export function supersededReasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "usannsynlig_pris_karantene") return "Satt i karantene: usannsynlig pris";
  const t = code.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toLocaleUpperCase("nb-NO") + t.slice(1) : null;
}
