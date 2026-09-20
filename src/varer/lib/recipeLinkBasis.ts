// Regner om en oppskrifts utbytte til varens salgsenhet.
//
// Regelen er streng med vilje: mangler grunnlaget, returneres null med en
// forklaring — aldri et tall som ser komplett ut. Ingenting utledes fra
// varenavn; antall per pakke må være bekreftet på koblingen.

export type SalesUnitBasis = "stk" | "vekt" | "flerpakk";

export const SALES_UNIT_BASIS_LABEL: Record<SalesUnitBasis, string> = {
  stk: "Per stykk",
  vekt: "Per vekt",
  flerpakk: "Flerpakning",
};

export const SALES_UNIT_BASIS_HELP: Record<SalesUnitBasis, string> = {
  stk: "Én salgsenhet er ett emne fra oppskriften.",
  vekt: "Salgsenheten selges etter vekt. Bekreftet vekt per salgsenhet brukes.",
  flerpakk: "Salgsenheten inneholder flere emner fra oppskriften.",
};

export function isSalesUnitBasis(value: unknown): value is SalesUnitBasis {
  return value === "stk" || value === "vekt" || value === "flerpakk";
}

/** Innstillingene som er lagret på koblingen mellom vare og oppskrift. */
export interface RecipeLinkSettings {
  sales_unit_basis?: string | null;
  units_per_sales_unit?: number | string | null;
  sales_unit_weight_g?: number | string | null;
  units_per_batch_override?: number | string | null;
  yield_weight_g_override?: number | string | null;
}

/** Beregnet grunnlag fra oppskriften selv (samme motor som oppskriftskortet). */
export interface RecipeBasisInput {
  /** Antall emner per batch fra oppskriften, eller null når det ikke er kjent. */
  unitCount?: number | null;
  /** Innveid deigvekt i gram. */
  totalDoughG?: number | null;
  /** Ferdigvekt for hele batchen i gram, når den er kjent. */
  finalWeightG?: number | null;
  /** Stykkvekt i gram, når oppskriften har den. */
  pieceWeightG?: number | null;
  /** Råvarekostnad for hele batchen. */
  totalCost?: number | null;
  /** Sann når minst én linje mangler kost eller vekt. */
  costIncomplete?: boolean;
}

export interface SalesUnitBasisResult {
  basis: SalesUnitBasis | null;
  /** Antall emner fra oppskriften per salgsenhet. */
  unitsPerSalesUnit: number | null;
  /** Antall emner per batch, etter eventuell overstyring på koblingen. */
  unitsPerBatch: number | null;
  /** Vekt per emne i gram. */
  weightPerUnitG: number | null;
  /** Vekt per salgsenhet i gram. */
  weightPerSalesUnitG: number | null;
  /** Antall salgsenheter per batch. */
  salesUnitsPerBatch: number | null;
  /** Råvarekostnad per emne. */
  costPerUnit: number | null;
  /** Råvarekostnad per salgsenhet. */
  costPerSalesUnit: number | null;
  /** Forklaringer på det som ikke lot seg beregne. Tom liste = komplett. */
  missing: string[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: number | string | null | undefined): number | null {
  const n = num(value);
  return n != null && n > 0 ? n : null;
}

/**
 * Regner oppskriftens utbytte om til varens salgsenhet.
 * Alle tall er null når grunnlaget mangler, og årsaken ligger i `missing`.
 */
export function computeSalesUnitBasis(
  link: RecipeLinkSettings | null | undefined,
  recipe: RecipeBasisInput | null | undefined,
): SalesUnitBasisResult {
  const missing: string[] = [];
  const basis = isSalesUnitBasis(link?.sales_unit_basis) ? link!.sales_unit_basis as SalesUnitBasis : null;

  const unitsPerBatch =
    positive(link?.units_per_batch_override) ?? positive(recipe?.unitCount) ?? null;

  const batchWeightG =
    positive(link?.yield_weight_g_override) ??
    positive(recipe?.finalWeightG) ??
    positive(recipe?.totalDoughG) ??
    null;

  const weightPerUnitG =
    positive(recipe?.pieceWeightG) ??
    (batchWeightG != null && unitsPerBatch != null ? batchWeightG / unitsPerBatch : null);

  const totalCost = num(recipe?.totalCost);
  const costUsable = totalCost != null && totalCost >= 0 && !recipe?.costIncomplete;
  if (!costUsable) missing.push("Råvarekostnaden er ufullstendig — én eller flere linjer mangler pris eller vekt.");

  const costPerUnit = costUsable && unitsPerBatch != null ? totalCost! / unitsPerBatch : null;

  const empty: SalesUnitBasisResult = {
    basis,
    unitsPerSalesUnit: null,
    unitsPerBatch,
    weightPerUnitG,
    weightPerSalesUnitG: null,
    salesUnitsPerBatch: null,
    costPerUnit,
    costPerSalesUnit: null,
    missing,
  };

  if (!basis) {
    missing.push("Salgsenheten er ikke bekreftet på koblingen ennå.");
    return empty;
  }

  if (basis === "vekt") {
    const weight = positive(link?.sales_unit_weight_g);
    if (weight == null) {
      missing.push("Vekt per salgsenhet er ikke bekreftet.");
      return empty;
    }
    if (batchWeightG == null) {
      missing.push("Oppskriften mangler utbytte i gram, så kostnad per salgsenhet kan ikke beregnes.");
      return { ...empty, weightPerSalesUnitG: weight };
    }
    const costPerSalesUnit = costUsable ? (totalCost! / batchWeightG) * weight : null;
    return {
      basis,
      unitsPerSalesUnit: null,
      unitsPerBatch,
      weightPerUnitG,
      weightPerSalesUnitG: weight,
      salesUnitsPerBatch: batchWeightG / weight,
      costPerUnit,
      costPerSalesUnit,
      missing,
    };
  }

  const unitsPerSalesUnit =
    basis === "stk" ? 1 : positive(link?.units_per_sales_unit);

  if (unitsPerSalesUnit == null) {
    missing.push("Antall enheter per salgsenhet er ikke bekreftet.");
    return empty;
  }

  if (unitsPerBatch == null) {
    missing.push("Oppskriften mangler antall emner per batch.");
  }
  if (weightPerUnitG == null) {
    missing.push("Stykkvekt kan ikke beregnes — utbytte eller antall emner mangler.");
  }

  const confirmedWeight = positive(link?.sales_unit_weight_g);
  const weightPerSalesUnitG =
    confirmedWeight ?? (weightPerUnitG != null ? weightPerUnitG * unitsPerSalesUnit : null);

  return {
    basis,
    unitsPerSalesUnit,
    unitsPerBatch,
    weightPerUnitG,
    weightPerSalesUnitG,
    salesUnitsPerBatch: unitsPerBatch != null ? unitsPerBatch / unitsPerSalesUnit : null,
    costPerUnit,
    costPerSalesUnit: costPerUnit != null ? costPerUnit * unitsPerSalesUnit : null,
    missing,
  };
}

/** Sann når grunnlaget er komplett nok til å vise tall uten forbehold. */
export function basisIsComplete(result: SalesUnitBasisResult): boolean {
  return result.missing.length === 0 && result.costPerSalesUnit != null;
}

/** Hvor en opplysning på varekortet kommer fra. */
export type FieldOrigin = "oppskrift" | "beregnet" | "manuell" | "mangler";

export const FIELD_ORIGIN_LABEL: Record<FieldOrigin, string> = {
  oppskrift: "Fra oppskrift",
  beregnet: "Beregnet",
  manuell: "Manuelt satt på varen",
  mangler: "Mangler",
};
