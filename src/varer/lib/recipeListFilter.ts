import { asDepartment } from "@/varer/lib/departments";
import type { RecipeListState } from "@/varer/lib/listUrlState";
import type { LabelingStatus } from "@/varer/lib/labelStaleness";

/** Feltene filtrering og sortering trenger — `RecipeRow` oppfyller dette. */
export interface FilterableRecipe {
  name: string | null;
  category: string | null;
  status: string | null;
  department: string | null;
  updated_at: string | null;
  products: string[];
  labeling: LabelingStatus;
  totals: { hydrationPct: number; totalDoughG: number };
}

/** Søk, filtre og sortering for oppskriftslisten. Rekkefølgen i inndata bevares ved likhet. */
export function filterAndSortRecipes<T extends FilterableRecipe>(rows: T[], s: RecipeListState): T[] {
  const q = s.q.trim().toLowerCase();
  const dir = s.dir === "asc" ? 1 : -1;
  const txt = (v: string | null | undefined) => (v ?? "").toLowerCase();
  const num = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : v);
  const cmpNum = (x: number | null, y: number | null) =>
    x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : (x - y) * dir;

  return rows
    .filter((r) => (s.status === "all" ? true : (r.status ?? "draft") === s.status))
    .filter((r) => (s.labeling === "all" ? true : r.labeling === s.labeling))
    .filter((r) => {
      if (s.dept === "all") return true;
      const d = asDepartment(r.department);
      return s.dept === "none" ? d === null : d === s.dept;
    })
    .filter((r) => {
      if (s.category === "all") return true;
      if (s.category === "none") return !r.category;
      return r.category === s.category;
    })
    .filter((r) => (!q ? true : `${r.name ?? ""} ${r.category ?? ""} ${r.products.join(" ")}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      switch (s.sort) {
        case "category":
          return txt(a.category).localeCompare(txt(b.category), "nb") * dir;
        case "department":
          return txt(asDepartment(a.department) ?? "").localeCompare(txt(asDepartment(b.department) ?? ""), "nb") * dir;
        case "hydration":
          return cmpNum(num(a.totals.hydrationPct), num(b.totals.hydrationPct));
        case "dough":
          return cmpNum(num(a.totals.totalDoughG), num(b.totals.totalDoughG));
        case "products":
          return (a.products.length - b.products.length) * dir;
        case "labeling":
          return txt(a.labeling).localeCompare(txt(b.labeling), "nb") * dir;
        case "status":
          return txt(a.status ?? "draft").localeCompare(txt(b.status ?? "draft"), "nb") * dir;
        case "updated":
          return ((a.updated_at ? new Date(a.updated_at).getTime() : 0) - (b.updated_at ? new Date(b.updated_at).getTime() : 0)) * dir;
        default:
          return txt(a.name).localeCompare(txt(b.name), "nb") * dir;
      }
    });
}
