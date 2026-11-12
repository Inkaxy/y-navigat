/**
 * Nettovekt per koblet vare: vekten per salgsenhet som er registrert på
 * koblingen (`sales_unit_weight_g`) eller på varen (`weight_per_unit_grams`),
 * og om den er bekreftet. Forslaget (antall emner × vekt per emne) er bare
 * hjelp og lagres aldri uten at brukeren bekrefter i salgsenhetsskjemaet.
 */
import { computeSalesUnitBasis, isSalesUnitBasis, type RecipeBasisInput } from "@/varer/lib/recipeLinkBasis";

export interface LinkWeightSource {
  sales_unit_basis?: string | null;
  units_per_sales_unit?: number | string | null;
  sales_unit_weight_g?: number | string | null;
  units_per_batch_override?: number | string | null;
  sales_unit_confirmed_at?: string | null;
  products?: { weight_per_unit_grams?: number | string | null } | null;
}

export interface LinkNetWeight {
  grams: number | null;
  source: "kobling" | "vare" | null;
  confirmedAt: string | null;
  suggestion: { grams: number; text: string } | null;
  /** Hvorfor det ikke finnes et forslag. */
  note: string | null;
}

function positive(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const g = (n: number) => `${Math.round(n).toLocaleString("nb-NO")} g`;

export function linkNetWeight(link: LinkWeightSource, recipe: RecipeBasisInput | null): LinkNetWeight {
  const onLink = positive(link.sales_unit_weight_g);
  const onProduct = positive(link.products?.weight_per_unit_grams);
  const grams = onLink ?? onProduct;
  const source = onLink != null ? "kobling" : onProduct != null ? "vare" : null;
  const confirmedAt = onLink != null ? link.sales_unit_confirmed_at ?? null : null;
  const base = { grams, source, confirmedAt } as const;

  if (!isSalesUnitBasis(link.sales_unit_basis)) {
    return { ...base, suggestion: null, note: "Salgsenheten er ikke bekreftet ennå — velg grunnlag før vekten settes." };
  }
  if (link.sales_unit_basis === "vekt") {
    return { ...base, suggestion: null, note: "Selges etter vekt — vekten per salgsenhet settes direkte." };
  }
  if (!recipe) return { ...base, suggestion: null, note: "Oppskriften er ikke lastet." };

  // Samme motor som varekortet, uten registrert vekt — forslaget skal ikke bygge på seg selv.
  const r = computeSalesUnitBasis({ ...link, sales_unit_weight_g: null }, recipe);
  const units = r.unitsPerSalesUnit;
  const finished = positive(recipe.finalWeightG);
  const perUnitFinished = finished != null && r.unitsPerBatch != null ? finished / r.unitsPerBatch : null;
  if (units != null && perUnitFinished != null) {
    return { ...base, suggestion: { grams: Math.round(units * perUnitFinished), text: `${units} × ferdigvekt ${g(perUnitFinished)}` }, note: null };
  }
  if (units != null && r.weightPerUnitG != null) {
    return { ...base, suggestion: { grams: Math.round(units * r.weightPerUnitG), text: `${units} × deigvekt ${g(r.weightPerUnitG)}` }, note: null };
  }
  return { ...base, suggestion: null, note: r.missing.find((m) => !m.startsWith("Råvarekostnaden")) ?? "Vekt per emne er ukjent." };
}
