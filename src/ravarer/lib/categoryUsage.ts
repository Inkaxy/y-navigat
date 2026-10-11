import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRowsExact } from "@/lib/countedPaging";

/**
 * Kategoribruk i ett selskap: én vare teller én gang per kategori, uansett om kategorien står i
 * `category`, `categories` eller begge (samme regel som varelisten: `categories` først, ellers `category`).
 * Hentes bevist komplett (eksakt antall, ingen 2000-grense).
 */
export interface CategoryCount { category: string; active: number; inactive: number }
export interface CategoryUsage {
  categories: CategoryCount[];
  /** Varer uten noen kategori. Vises med egen tekst, aldri som en tom kategorirad. */
  uncategorized: { active: number; inactive: number };
  totalMaterials: number;
}

interface Row { id: string; category: string | null; categories: string[] | null; is_active: boolean | null }

export function categoriesOfRow(r: Pick<Row, "category" | "categories">): string[] {
  const clean = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");
  const list = (r.categories ?? []).map(clean).filter((c) => c.length > 0);
  const src = list.length > 0 ? list : [clean(r.category)].filter((c) => c.length > 0);
  return [...new Set(src)];
}

export function summarizeCategoryUsage(rows: readonly Row[]): CategoryUsage {
  const m = new Map<string, CategoryCount>();
  const uncategorized = { active: 0, inactive: 0 };
  for (const r of rows) {
    const active = r.is_active !== false;
    const cats = categoriesOfRow(r);
    if (cats.length === 0) {
      if (active) uncategorized.active++; else uncategorized.inactive++;
      continue;
    }
    for (const c of cats) {
      const e = m.get(c) ?? { category: c, active: 0, inactive: 0 };
      if (active) e.active++; else e.inactive++;
      m.set(c, e);
    }
  }
  return {
    categories: [...m.values()].sort((a, b) => a.category.localeCompare(b.category, "nb")),
    uncategorized,
    totalMaterials: rows.length,
  };
}

export async function fetchCategoryUsage(legalEntityId: string): Promise<CategoryUsage> {
  const rows = await fetchAllRowsExact<Row>((from, to) =>
    supabase
      .from("raw_materials")
      .select("id, category, categories, is_active", { count: "exact" })
      .eq("legal_entity_id", legalEntityId)
      .order("id")
      .range(from, to),
  );
  return summarizeCategoryUsage(rows);
}

export const CATEGORY_USAGE_KEY = "raw-material-category-usage";

export function useCategoryUsage(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: [CATEGORY_USAGE_KEY, legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchCategoryUsage(legalEntityId!),
  });
}
