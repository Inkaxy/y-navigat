import { parseDecimal } from "@/ravarer/lib/packageMath";

export type CostPriceSource = "manual" | "agreement" | "price_list" | "invoice";

export interface CostPriceDraft {
  price: string;
  date: string;
  supplierId: string | null;
  source: CostPriceSource;
  reason: string;
  setAsCurrent: boolean;
}

export interface CostPriceErrors { price?: string; date?: string; reason?: string }

/** Validerer skjemaet. Desimalkomma godtas. Begrunnelse minst 3 tegn. */
export function validateCostPrice(d: CostPriceDraft): { ok: true; price: number } | { ok: false; errors: CostPriceErrors } {
  const errors: CostPriceErrors = {};
  const price = parseDecimal(d.price);
  if (price == null) errors.price = "Skriv inn en pris";
  else if (price < 0) errors.price = "Prisen kan ikke være negativ";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) errors.date = "Velg en dato";
  if (d.reason.trim().length < 3) errors.reason = "Skriv en begrunnelse (minst 3 tegn)";
  if (Object.keys(errors).length > 0 || price == null) return { ok: false, errors };
  return { ok: true, price };
}

/** Argumentene til `useAddPriceHistory` — eneste skrivevei for manuell kostpris. */
export function toPriceHistoryInput(rawMaterialId: string, d: CostPriceDraft, price: number) {
  return {
    raw_material_id: rawMaterialId,
    supplier_id: d.supplierId,
    price,
    effective_date: d.date,
    source: d.source,
    notes: d.reason.trim(),
    set_as_current: d.setAsCurrent,
  };
}
