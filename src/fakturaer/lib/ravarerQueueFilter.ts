import { normalizeSearch } from "@/ravarer/lib/rawMaterialViews";
import { RAVARE_KINDS, type DecisionGroup, type DecisionKind } from "@/fakturaer/lib/decisionGroups";

export type RavarerFilterKind = "alle" | "material" | "package" | "first_cost" | "price" | "other";
export type QueueScope = "ravarer" | "alle";

export const RAVARER_FILTERS: ReadonlyArray<{ key: RavarerFilterKind; label: string }> = [
  { key: "alle", label: "Alle" },
  { key: "material", label: "Velg råvare" },
  { key: "package", label: "Pakning" },
  { key: "first_cost", label: "Første kostpris" },
];

/** Filtre for «Alle beslutninger» — inkluderer prisavvik og øvrige typer. */
export const ALL_DECISION_FILTERS: ReadonlyArray<{ key: RavarerFilterKind; label: string }> = [
  ...RAVARER_FILTERS,
  { key: "price", label: "Prisavvik" },
  { key: "other", label: "Annet" },
];

export const filtersFor = (scope: QueueScope) => (scope === "alle" ? ALL_DECISION_FILTERS : RAVARER_FILTERS);

export const RAVARER_PAGE_SIZE = 12;

export interface RavarerFilter {
  kind: RavarerFilterKind;
  search: string;
  supplierId: string;
}

/** Leser filteret fra URL-en; ukjente verdier faller tilbake til «Alle». */
export function parseRavarerFilter(sp: URLSearchParams, scope: QueueScope = "ravarer"): RavarerFilter & { page: number } {
  const k = sp.get("type");
  const kind = (filtersFor(scope).some((f) => f.key === k) ? k : "alle") as RavarerFilterKind;
  const p = Number(sp.get("side"));
  return { kind, search: sp.get("q") ?? "", supplierId: sp.get("leverandor") ?? "", page: Number.isInteger(p) && p > 0 ? p : 1 };
}

/** Filtrerer HELE køen (alle grupper), aldri en avkortet side. */
export function filterRavarerGroups(groups: readonly DecisionGroup[], f: RavarerFilter, scope: QueueScope = "ravarer"): DecisionGroup[] {
  const s = normalizeSearch(f.search.trim());
  return groups.filter((g) => {
    if (scope === "ravarer" && !RAVARE_KINDS.has(g.kind)) return false;
    if (f.kind !== "alle" && g.kind !== (f.kind as DecisionKind)) return false;
    if (f.supplierId && g.supplierId !== f.supplierId) return false;
    if (!s) return true;
    return [g.description, g.sku ?? "", g.supplierName].some((v) => normalizeSearch(v).includes(s));
  });
}

export function paginate<T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages };
}

/** Neste spørsmål etter lagring: neste i samme filtrerte rekkefølge, ellers første andre. */
export function nextGroupKey(ordered: readonly DecisionGroup[], currentKey: string): string | null {
  const i = ordered.findIndex((g) => g.key === currentKey);
  const after = ordered.slice(i + 1).find((g) => g.key !== currentKey);
  return (after ?? ordered.find((g) => g.key !== currentKey))?.key ?? null;
}

/** Sum per valuta — beløp i ulike valutaer legges aldri sammen. */
export function sumByCurrency(rows: ReadonlyArray<{ total_amount: number | null; currency: string | null }>): Array<{ currency: string; total: number; missing: number }> {
  const m = new Map<string, { total: number; missing: number }>();
  for (const r of rows) {
    const c = (r.currency ?? "NOK").toUpperCase();
    const e = m.get(c) ?? { total: 0, missing: 0 };
    const v = r.total_amount == null ? NaN : Number(r.total_amount);
    if (Number.isFinite(v)) e.total = Math.round((e.total + v) * 100) / 100;
    else e.missing++;
    m.set(c, e);
  }
  return [...m.entries()].map(([currency, e]) => ({ currency, ...e })).sort((a, b) => a.currency.localeCompare(b.currency));
}
