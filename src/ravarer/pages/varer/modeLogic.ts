/**
 * Ren logikk for varearbeidsflatens modusadaptere: URL-tilstand og NØYAKTIG rekkefølge.
 * Samme funksjoner brukes av listen og av råvarekortets forrige/neste — aldri en kopi.
 */
import { matchesPackageFilter, parsePackageFilter, parsePackageStatusFilter, type PackageFilter } from "@/ravarer/lib/packageFilter";
import { compareValues } from "@/ravarer/ui/dataTableLogic";
import { normalizeSearch } from "@/ravarer/lib/rawMaterialViews";
import type { PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";

// ---------- Pakning ----------

export const PACKAGE_SORT_KEYS = [
  "name", "base_unit", "current_cost_price", "referansepris", "foreslatt_fra_navn", "pakningsfaktor",
  "enheter_i_bruk", "antall_fakturalinjer", "kjopt_kr_totalt", "pris_spredning", "status",
] as const;
export type PackageSortKey = (typeof PACKAGE_SORT_KEYS)[number];

export interface PackageQuery {
  filter: PackageFilter;
  status: string | null;
  q: string;
  sort: { key: PackageSortKey; dir: "asc" | "desc" };
}

/** `filter` kan være chip eller status (gammel lenke `?filter=ustabil_pris`); `pstatus` er statuskortet. */
export function readPackageQuery(sp: URLSearchParams): PackageQuery {
  const rawFilter = sp.get("filter");
  const [k, d] = (sp.get("sort") ?? "kjopt_kr_totalt:desc").split(":");
  return {
    filter: parsePackageFilter(rawFilter),
    status: parsePackageStatusFilter(sp.get("pstatus")) ?? parsePackageStatusFilter(rawFilter),
    q: sp.get("q") ?? "",
    sort: {
      key: (PACKAGE_SORT_KEYS as readonly string[]).includes(k) ? (k as PackageSortKey) : "kjopt_kr_totalt",
      dir: d === "asc" ? "asc" : "desc",
    },
  };
}

export type PackageOrderRow = Pick<PackageWorklistRow, "id" | "name" | "status" | "bekreftet_dato" | PackageSortKey>;

export function orderPackageRows<T extends PackageOrderRow>(rows: readonly T[], query: PackageQuery, suspiciousIds: ReadonlySet<string>): T[] {
  const needle = normalizeSearch(query.q);
  const arr = rows.filter(
    (r) =>
      matchesPackageFilter(r, query.filter, suspiciousIds) &&
      (!query.status || r.status === query.status) &&
      (!needle || normalizeSearch(r.name).includes(needle)),
  );
  const key = query.sort.key;
  const out = [...arr];
  out.sort((a, b) => {
    const av = a[key] ?? null;
    const bv = b[key] ?? null;
    if (av == null || bv == null) return compareValues(av, bv);
    const c = compareValues(av, bv);
    return query.sort.dir === "asc" ? c : -c;
  });
  return out;
}

// ---------- Deklarasjon ----------

export interface DeclarationOrderRow {
  raw_material_id: string;
  name: string;
  is_composite: boolean;
}

/** Arbeidslisten er allerede sortert «tyngst brukt først» av serveren; søk filtrerer, rekkefølgen beholdes. */
export function orderDeclarationRows<T extends DeclarationOrderRow>(rows: readonly T[], q: string): T[] {
  const needle = normalizeSearch(q);
  return rows.filter((r) => !needle || normalizeSearch(r.name).includes(needle));
}

// ---------- Næring ----------

export interface NutritionOrderRow {
  raw_material_id: string;
  name: string;
}

/** Kandidatene kommer i dekningsviewets prioritetsrekkefølge; overhoppede (økt) og søk filtrerer. */
export function orderNutritionRows<T extends NutritionOrderRow>(rows: readonly T[], q: string, skipped: ReadonlySet<string>): T[] {
  const needle = normalizeSearch(q);
  return rows.filter((r) => !skipped.has(r.raw_material_id) && (!needle || normalizeSearch(r.name).includes(needle)));
}

// ---------- Datablad ----------

export type DatasheetView = "unacked" | "all";
export const readDatasheetView = (sp: URLSearchParams): DatasheetView => (sp.get("visning") === "alle" ? "all" : "unacked");

export interface DatasheetOrderRow {
  id: string;
  raw_material_id: string;
  created_at: string;
  raw_materials?: { name: string; sku: string };
}

/** Nyeste først (som serveren), stabil på hendelses-ID. Hver hendelse er én rad — også flere på samme råvare. */
export function orderDatasheetRows<T extends DatasheetOrderRow>(rows: readonly T[], q: string): T[] {
  const needle = normalizeSearch(q);
  return rows
    .filter((r) => !needle || normalizeSearch(r.raw_materials?.name).includes(needle))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

// ---------- Navigasjon ----------

export interface NavEntry {
  materialId: string;
  /** Hendelses-ID når listen er hendelser (datablad). */
  eventId?: string;
}

/** Forrige/neste i NØYAKTIG arbeidslisterekkefølge. Med `eventId` brukes hendelsen, ellers første forekomst av råvaren. */
export function stepEntries(entries: readonly NavEntry[], materialId: string, eventId: string | null): { prev: NavEntry | null; next: NavEntry | null; index: number } {
  const i = eventId
    ? entries.findIndex((e) => e.eventId === eventId && e.materialId === materialId)
    : entries.findIndex((e) => e.materialId === materialId);
  if (i < 0) return { prev: null, next: null, index: -1 };
  return { prev: i > 0 ? entries[i - 1] : null, next: i < entries.length - 1 ? entries[i + 1] : null, index: i };
}
