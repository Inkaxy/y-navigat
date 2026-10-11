import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { BAKERS_RM_SELECT } from "@/varer/lib/bakersRawMaterials";
import type { BakersRawMaterial } from "@/varer/lib/bakers";
import { computeRecipeUsage, type RecipeUsageRow, type UsageLineInput } from "@/ravarer/lib/recipeUsage";

export type { RecipeUsageRow } from "@/ravarer/lib/recipeUsage";

const LINE_SELECT = "id, recipe_id, recipe_part_id, raw_material_id, sub_product_id, ingredient_name, quantity, unit, waste_percent";
const CHUNK = 200;

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/**
 * Oppskrifter som bruker råvaren, med kost fra felles linjemotor (`recipeUsage.ts`).
 * Alle linjer hentes paginert (ingen stille avkorting); prisen leses fersk fra
 * `raw_materials` (status/enhet/tetthet/stykkvekt) i samme henting som nevneren.
 * Nøkkelen er familien `recipes-using-raw-material` — `invalidateRawMaterial` treffer den globalt.
 */
export function useRecipesUsingRawMaterial(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["recipes-using-raw-material", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: () => fetchRecipeUsage(rawMaterialId as string),
  });
}

export async function fetchRecipeUsage(rawMaterialId: string): Promise<RecipeUsageRow[]> {
  const mine = await fetchAllRows<{ recipe_id: string }>((from, to) =>
    supabase.from("recipe_lines").select("recipe_id").eq("raw_material_id", rawMaterialId).order("id").range(from, to));
  const recipeIds = Array.from(new Set(mine.map((l) => l.recipe_id)));
  if (recipeIds.length === 0) return [];

  const allLines: UsageLineInput[] = [];
  const recipes = new Map<string, { name: string; status: string | null }>();
  for (const ids of chunks(recipeIds)) {
    const [lines, recs] = await Promise.all([
      fetchAllRows<UsageLineInput>((from, to) =>
        supabase.from("recipe_lines").select(LINE_SELECT).in("recipe_id", ids).order("id").range(from, to)),
      supabase.from("recipes").select("id, name, status").in("id", ids),
    ]);
    if (recs.error) throw recs.error;
    allLines.push(...lines);
    for (const r of recs.data ?? []) recipes.set(r.id, { name: r.name ?? "Uten navn", status: r.status ?? null });
  }

  const rmIds = Array.from(new Set(allLines.map((l) => l.raw_material_id).filter((v): v is string => !!v)));
  const materials: Record<string, BakersRawMaterial> = {};
  for (const ids of chunks(rmIds)) {
    const { data, error } = await supabase.from("raw_materials").select(BAKERS_RM_SELECT).in("id", ids);
    if (error) throw error;
    for (const r of (data ?? []) as BakersRawMaterial[]) materials[r.id] = r;
  }
  return computeRecipeUsage({ selectedId: rawMaterialId, allLines, materials, recipes, complete: true });
}

/** Antall oppskrifter som bruker råvaren — brukt i KPI-stripa. */
export function useRecipeUsageCount(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["recipe-usage-count", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_lines")
        .select("recipe_id")
        .eq("raw_material_id", rawMaterialId!)
        .limit(1000);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.recipe_id)).size;
    },
  });
}
