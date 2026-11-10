/**
 * Kilopris for en koblet vare: pris (eller kost) delt på vekten av én
 * salgsenhet. Vekten hentes bare fra det som er registrert — bekreftet vekt på
 * koblingen først, deretter vekten på varekortet. Den regnes aldri ut fra
 * oppskriften her. Mangler vekten, er kiloprisen ukjent (null), aldri 0.
 */

export type SalesUnitWeightSource = "kobling" | "vare";

export type SalesUnitWeight =
  | { grams: number; source: SalesUnitWeightSource; reason: null }
  | { grams: null; source: null; reason: string };

export const SALES_UNIT_WEIGHT_SOURCE_LABEL: Record<SalesUnitWeightSource, string> = {
  kobling: "bekreftet på koblingen",
  vare: "fra varekortet",
};

export const MISSING_WEIGHT_REASON =
  "Vekt per salgsenhet er ikke registrert på koblingen eller varen, så kiloprisen kan ikke regnes ut.";

function positive(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function salesUnitWeight(
  link: { sales_unit_weight_g?: number | string | null } | null | undefined,
  product: { weight_per_unit_grams?: number | string | null } | null | undefined,
): SalesUnitWeight {
  const onLink = positive(link?.sales_unit_weight_g);
  if (onLink != null) return { grams: onLink, source: "kobling", reason: null };
  const onProduct = positive(product?.weight_per_unit_grams);
  if (onProduct != null) return { grams: onProduct, source: "vare", reason: null };
  return { grams: null, source: null, reason: MISSING_WEIGHT_REASON };
}

/** Kroner per kg. Null når beløp eller vekt er ukjent. Negativt beløp godtas ikke. */
export function perKg(amount: number | null | undefined, grams: number | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  if (grams == null || !Number.isFinite(grams) || grams <= 0) return null;
  return amount / (grams / 1000);
}
