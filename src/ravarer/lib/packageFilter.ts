/** Filterchipene på pakningssiden, lest fra og skrevet til `?filter=`. */

export const PACKAGE_FILTERS = ["ubekreftet", "mistenkelig", "bekreftet", "alle"] as const;

export type PackageFilter = (typeof PACKAGE_FILTERS)[number];

export const PACKAGE_FILTER_LABEL: Record<PackageFilter, string> = {
  ubekreftet: "Ubekreftet",
  mistenkelig: "Mistenkelig",
  bekreftet: "Bekreftet",
  alle: "Alle",
};

/** Statusfiltrene (kortene) på pakningssiden — kan også komme fra URL, f.eks. `?filter=ustabil_pris`. */
export const PACKAGE_STATUS_FILTERS = ["mangler_pakning", "avviker_fra_referanse", "ustabil_pris", "linjer_uten_pris", "mangler_kostpris", "ikke_bekreftet", "ok"] as const;
export type PackageStatusFilter = (typeof PACKAGE_STATUS_FILTERS)[number];

/** Statusfilteret i `?filter=`, ellers null. */
export function parsePackageStatusFilter(value: string | null | undefined): PackageStatusFilter | null {
  const v = (value ?? "").trim().toLowerCase();
  return (PACKAGE_STATUS_FILTERS as readonly string[]).includes(v) ? (v as PackageStatusFilter) : null;
}

/**
 * Tolker `?filter=`. En status (f.eks. `ustabil_pris`) gir chipen «alle» — statusen filtreres i tillegg. Ukjent eller manglende verdi gir «ubekreftet», som er
 * jobben man kommer hit for å gjøre.
 */
export function parsePackageFilter(value: string | null | undefined): PackageFilter {
  const v = (value ?? "").trim().toLowerCase();
  if (parsePackageStatusFilter(v)) return "alle";
  return (PACKAGE_FILTERS as readonly string[]).includes(v) ? (v as PackageFilter) : "ubekreftet";
}

export interface PackageFilterRow {
  /** Dato pakningen ble bekreftet, null når den ikke er bekreftet. */
  bekreftet_dato: string | null;
}

/** Passer raden inn i valgt chip? `suspiciousIds` kommer fra mistanke-hooken. */
export function matchesPackageFilter(
  row: PackageFilterRow & { id: string },
  filter: PackageFilter,
  suspiciousIds: ReadonlySet<string>,
): boolean {
  switch (filter) {
    case "alle":
      return true;
    case "bekreftet":
      return !!row.bekreftet_dato;
    case "mistenkelig":
      return suspiciousIds.has(row.id);
    case "ubekreftet":
    default:
      return !row.bekreftet_dato;
  }
}
