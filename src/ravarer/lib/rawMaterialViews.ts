/**
 * Rene hjelpere for varelisten i Råvarer: søkenormalisering, avviksberegning
 * og de lagrede visningene. Alt her er uten React/Supabase slik at det kan
 * testes direkte (se src/test/rawMaterialViews.test.ts).
 */

/** Små bokstaver, uten diakritika, komprimerte mellomrom. */
export function normalizeSearch(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Deler søket i ord — alle ord må finnes (AND). */
export function searchTokens(query: string): string[] {
  return normalizeSearch(query).split(" ").filter(Boolean);
}

export function matchesSearch(searchText: string, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  return tokens.every((t) => searchText.includes(t));
}

/** Bygger ett normalisert søkefelt av alle kildene vi søker i. */
export function buildSearchText(parts: readonly (string | null | undefined)[]): string {
  return normalizeSearch(parts.filter(Boolean).join(" "));
}

/** Avvik i prosent mellom siste fakturapris og kostpris. Null når data mangler. */
export function deviationPct(
  lastInvoicePrice: number | null | undefined,
  costPrice: number | null | undefined,
): number | null {
  if (lastInvoicePrice == null || costPrice == null) return null;
  if (!Number.isFinite(lastInvoicePrice) || !Number.isFinite(costPrice)) return null;
  if (costPrice === 0) return null;
  return ((lastInvoicePrice - costPrice) / Math.abs(costPrice)) * 100;
}

export type PackageState = "confirmed" | "unconfirmed" | "missing";

/** Rad slik varelisten trenger den — uavhengig av databaseformen. */
export interface RawMaterialListItem {
  id: string;
  sku: string;
  name: string;
  declarationName: string | null;
  categories: string[];
  itemType: string;
  isActive: boolean;
  baseUnit: string;
  costPrice: number | null;
  costSource: string | null;
  costUpdatedAt: string | null;
  agreedPrice: number | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierSku: string | null;
  /** Treff i søket som kom fra leverandørnummer/alias (vises som chip). */
  matchedAlias: string | null;
  lastInvoicePrice: number | null;
  lastInvoiceDate: string | null;
  deviation: number | null;
  packageState: PackageState;
  volume12m: number;
  currentStock: number;
  stockTracking: boolean;
  minStock: number | null;
  hasNutrition: boolean;
  hasDatasheet: boolean;
  hasAllergens: boolean;
  searchText: string;
  aliases: string[];
}

export const DEFAULT_DEVIATION_TOLERANCE = 5;

export interface ViewDefinition {
  id: string;
  label: string;
  predicate: (item: RawMaterialListItem, tolerance: number) => boolean;
}

/** Innebygde visninger. Rekkefølgen styrer chip-rekkefølgen i UI. */
export const BUILTIN_VIEWS: ViewDefinition[] = [
  { id: "all", label: "Alle", predicate: () => true },
  {
    id: "missing_package",
    label: "Mangler pakning",
    predicate: (i) => i.packageState !== "confirmed",
  },
  {
    id: "missing_declaration",
    label: "Mangler deklarasjonsnavn",
    predicate: (i) => !i.declarationName?.trim(),
  },
  { id: "missing_nutrition", label: "Mangler næring", predicate: (i) => !i.hasNutrition },
  {
    id: "deviation",
    label: "Avvik > toleranse",
    predicate: (i, tolerance) => i.deviation != null && Math.abs(i.deviation) > tolerance,
  },
  { id: "not_purchased", label: "Ikke kjøpt 12 mnd", predicate: (i) => i.volume12m <= 0 },
  { id: "no_supplier", label: "Uten leverandør", predicate: (i) => !i.supplierId },
  { id: "inactive", label: "Inaktive", predicate: (i) => !i.isActive },
];

export function viewById(id: string): ViewDefinition | undefined {
  return BUILTIN_VIEWS.find((v) => v.id === id);
}

/** Filtrerer på en innebygd visning. Ukjent id gir uendret liste. */
export function applyView(
  items: readonly RawMaterialListItem[],
  viewId: string,
  tolerance = DEFAULT_DEVIATION_TOLERANCE,
): RawMaterialListItem[] {
  const view = viewById(viewId);
  if (!view) return [...items];
  return items.filter((i) => view.predicate(i, tolerance));
}

export type ListSortKey =
  | "sku"
  | "name"
  | "category"
  | "supplier"
  | "cost"
  | "agreed"
  | "deviation"
  | "package"
  | "volume_12m"
  | "last_invoice"
  | "active";

const PACKAGE_ORDER: Record<PackageState, number> = { missing: 0, unconfirmed: 1, confirmed: 2 };

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a - b;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "nb");
}

/** Sorterer en kopi av listen. Retning håndteres av kalleren via `dir`. */
export function sortItems(
  items: readonly RawMaterialListItem[],
  key: ListSortKey,
  dir: "asc" | "desc",
): RawMaterialListItem[] {
  const sign = dir === "asc" ? 1 : -1;
  const arr = [...items];
  arr.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "sku":
        cmp = compareText(a.sku, b.sku);
        break;
      case "category":
        cmp = compareText(a.categories[0] ?? "", b.categories[0] ?? "");
        break;
      case "supplier":
        cmp = compareText(a.supplierName ?? "", b.supplierName ?? "");
        break;
      case "cost":
        cmp = compareNullableNumber(a.costPrice, b.costPrice);
        break;
      case "agreed":
        cmp = compareNullableNumber(a.agreedPrice, b.agreedPrice);
        break;
      case "deviation":
        cmp = compareNullableNumber(
          a.deviation == null ? null : Math.abs(a.deviation),
          b.deviation == null ? null : Math.abs(b.deviation),
        );
        break;
      case "package":
        cmp = PACKAGE_ORDER[a.packageState] - PACKAGE_ORDER[b.packageState];
        break;
      case "volume_12m":
        cmp = a.volume12m - b.volume12m;
        break;
      case "last_invoice":
        cmp = compareText(a.lastInvoiceDate ?? "", b.lastInvoiceDate ?? "");
        break;
      case "active":
        cmp = Number(a.isActive) - Number(b.isActive);
        break;
      default:
        cmp = 0;
    }
    if (cmp === 0) cmp = compareText(a.name, b.name);
    return cmp * sign;
  });
  return arr;
}

/** Filtrene som ligger i URL-en på varelisten. Deles med råvaredetaljen
 *  slik at «forrige/neste» følger nøyaktig samme rekkefølge som listen. */
export interface ListQuery {
  q: string;
  kat: string;
  type: string;
  status: string;
  view: string;
  sortKey: ListSortKey;
  sortDir: "asc" | "desc";
}

const SORT_KEYS: ListSortKey[] = [
  "sku", "name", "category", "supplier", "cost", "agreed",
  "deviation", "package", "volume_12m", "last_invoice", "active",
];

export function parseListQuery(params: URLSearchParams): ListQuery {
  const [rawKey, rawDir] = (params.get("sort") ?? "name:asc").split(":");
  return {
    q: params.get("q") ?? "",
    kat: params.get("kat") ?? "all",
    type: params.get("type") ?? "all",
    status: params.get("status") ?? "active",
    view: params.get("view") ?? "all",
    sortKey: SORT_KEYS.includes(rawKey as ListSortKey) ? (rawKey as ListSortKey) : "name",
    sortDir: rawDir === "desc" ? "desc" : "asc",
  };
}

/** Full filtrering + sortering av varelisten, inkludert alias-treff-merking. */
export function filterAndSortItems(
  items: readonly RawMaterialListItem[],
  query: ListQuery,
  tolerance = DEFAULT_DEVIATION_TOLERANCE,
): RawMaterialListItem[] {
  const needle = normalizeSearch(query.q);
  const base = items.filter((i) => {
    if (query.status === "active" && !i.isActive) return false;
    if (query.status === "inactive" && i.isActive) return false;
    if (query.type !== "all" && i.itemType !== query.type) return false;
    if (query.kat !== "all" && !i.categories.includes(query.kat)) return false;
    if (needle && !matchesSearch(i.searchText, query.q)) return false;
    return true;
  });

  const withAlias =
    needle.length === 0
      ? base
      : base.map((i) => {
          if (normalizeSearch(`${i.name} ${i.sku}`).includes(needle)) return i;
          const hit =
            [i.supplierSku, ...i.aliases].find((v) => v && normalizeSearch(v).includes(needle)) ?? null;
          return hit ? { ...i, matchedAlias: hit } : i;
        });

  return sortItems(applyView(withAlias, query.view, tolerance), query.sortKey, query.sortDir);
}
