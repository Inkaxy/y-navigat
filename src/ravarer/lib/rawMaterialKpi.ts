/**
 * Rene beregninger til KPI-stripa på råvaredetaljen. Holdt utenfor React slik
 * at reglene (hvilken avtalepris som gjelder, hva avviket måles mot) kan testes
 * direkte — se src/test/rawMaterialKpi.test.ts.
 */

/** Pris per pakning = kostpris per grunnenhet × antall grunnenheter i pakningen. */
export function pricePerPackage(
  costPerBaseUnit: number | null | undefined,
  baseUnitsPerPackage: number | null | undefined,
): number | null {
  if (costPerBaseUnit == null || baseUnitsPerPackage == null) return null;
  if (!Number.isFinite(costPerBaseUnit) || !Number.isFinite(baseUnitsPerPackage)) return null;
  if (baseUnitsPerPackage <= 0) return null;
  return costPerBaseUnit * baseUnitsPerPackage;
}

export interface AgreedPriceInput {
  /** Primærkoblingens pris per grunnenhet. */
  linkPricePerBaseUnit?: number | null;
  linkValidFrom?: string | null;
  linkValidTo?: string | null;
  /** Fallback på råvaren (tolkes alltid som per grunnenhet i UI). */
  rawMaterialAgreedPrice?: number | null;
}

export interface AgreedPriceResult {
  value: number | null;
  source: "link" | "raw_material" | "none";
  validFrom: string | null;
  validTo: string | null;
}

/**
 * Avtaleprisen som skal vises: primærkoblingens `agreed_price_per_base_unit`
 * når den finnes, ellers råvarens `agreed_price`.
 */
export function chooseAgreedPrice(input: AgreedPriceInput): AgreedPriceResult {
  const link = input.linkPricePerBaseUnit;
  if (link != null && Number.isFinite(link)) {
    return {
      value: link,
      source: "link",
      validFrom: input.linkValidFrom ?? null,
      validTo: input.linkValidTo ?? null,
    };
  }
  const rm = input.rawMaterialAgreedPrice;
  if (rm != null && Number.isFinite(rm)) {
    return { value: rm, source: "raw_material", validFrom: null, validTo: null };
  }
  return { value: null, source: "none", validFrom: null, validTo: null };
}

export interface KpiDeviation {
  pct: number | null;
  /** Hva avviket er målt mot. */
  basis: "avtale" | "kostpris" | null;
}

/**
 * Avvik måles mot avtaleprisen når den finnes, ellers mot kostprisen.
 * Positivt tall = fakturert dyrere enn referansen.
 */
export function kpiDeviation(
  lastInvoicePrice: number | null | undefined,
  agreedPrice: number | null | undefined,
  costPrice: number | null | undefined,
): KpiDeviation {
  if (lastInvoicePrice == null || !Number.isFinite(lastInvoicePrice)) return { pct: null, basis: null };
  const reference =
    agreedPrice != null && Number.isFinite(agreedPrice) && agreedPrice !== 0
      ? { value: agreedPrice, basis: "avtale" as const }
      : costPrice != null && Number.isFinite(costPrice) && costPrice !== 0
        ? { value: costPrice, basis: "kostpris" as const }
        : null;
  if (!reference) return { pct: null, basis: null };
  return {
    pct: ((lastInvoicePrice - reference.value) / Math.abs(reference.value)) * 100,
    basis: reference.basis,
  };
}

/** Pakningspris → pris per grunnenhet. Brukes i avtaledialogene. */
export function perBaseUnitFromPackage(
  packagePrice: number | null | undefined,
  baseUnitsPerPackage: number | null | undefined,
): number | null {
  if (packagePrice == null || baseUnitsPerPackage == null) return null;
  if (!Number.isFinite(packagePrice) || !Number.isFinite(baseUnitsPerPackage)) return null;
  if (baseUnitsPerPackage <= 0) return null;
  return packagePrice / baseUnitsPerPackage;
}
