/**
 * Rene hjelpere for prisbevaring på kundeordre.
 *
 * Bakgrunn: åpner man en lagret ordre, bytter leveringsdato og går tilbake til
 * den opprinnelige datoen, skal linjene få tilbake de avtalte prisene ordren
 * ble lagret med — ikke bli stående med prisene fra mellomdatoen. Manuelle
 * overstyringer skal aldri overskrives.
 */

export type LoadedLinePrice = {
  unit_price: string;
  source: string | null;
  source_id: string | null;
  effective: number;
};

export type RepricableLine = {
  id?: string;
  unit_price: string;
  unit_price_source?: string | null;
  unit_price_source_id?: string | null;
  base_price_source?: string | null;
  base_price_source_id?: string | null;
  is_fallback?: boolean;
  effective_price?: number | null;
};

export function isManualOverrideSource(source: string | null | undefined): boolean {
  return source === "manual_override";
}

/** Gjenoppretter prisene ordren ble lastet med. Manuelle priser røres ikke. */
export function restoreLoadedPrices<T extends RepricableLine>(
  lines: T[],
  baseline: Map<string, LoadedLinePrice>,
): T[] {
  return lines.map((l) => {
    if (!l.id || isManualOverrideSource(l.unit_price_source)) return l;
    const base = baseline.get(l.id);
    if (!base) return l;
    const manualBase = isManualOverrideSource(base.source);
    return {
      ...l,
      unit_price: base.unit_price,
      unit_price_source: base.source,
      unit_price_source_id: base.source_id,
      base_price_source: manualBase ? null : base.source,
      base_price_source_id: manualBase ? null : base.source_id,
      is_fallback: false,
      effective_price: base.effective,
    };
  });
}

/**
 * Mva-satsen som skal lagres på en linje. Faktisk lagret sats vinner alltid
 * over produktets standardsats — et syntetisk produkt-snapshot i redigering
 * har 15 % selv om linjen er lagret med 25 % eller 0 %.
 */
export function resolveLineVatRate(
  existingVatRate: number | null | undefined,
  productMvaRate: number | null | undefined,
): number {
  if (existingVatRate !== null && existingVatRate !== undefined && Number.isFinite(existingVatRate)) {
    return existingVatRate;
  }
  if (productMvaRate !== null && productMvaRate !== undefined && Number.isFinite(productMvaRate)) {
    return productMvaRate;
  }
  return 15;
}
