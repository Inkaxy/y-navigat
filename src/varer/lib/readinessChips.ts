/**
 * Rad fra viewet `product_calc_readiness`, brukt til å avlede kalkylestatus
 * og manglende-chips i vareliste og kostkort.
 */
export interface ProductCalcReadinessRow {
  status: string | null;
  mangler: string[] | null;
}

export interface ReadinessChip {
  key: string;
  label: string;
}

/** Menneskelesbare norske tekster for manglene fra viewet. */
const MANGLER_LABEL: Record<string, string> = {
  calc_type_ikke_satt: "Kalkyletype ikke satt",
  ingen_oppskrift: "Ingen oppskrift koblet",
  ingen_pris: "Ingen pris satt",
  manuell_pris_mangler: "Manuell kostpris mangler",
};

/** Chipsene som skal vises for én produktrad, med norsk tekst. */
export function readinessChips(row: ProductCalcReadinessRow | null | undefined): ReadinessChip[] {
  if (!row?.mangler) return [];
  return row.mangler.map((m) => ({ key: m, label: MANGLER_LABEL[m] ?? m }));
}

/** Status A/B/C — «–» når viewet ikke har noen rad ennå. */
export function readinessStatusLabel(row: ProductCalcReadinessRow | null | undefined): string {
  return row?.status ?? "–";
}
