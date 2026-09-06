import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RecipeUsageRow {
  recipeId: string;
  recipeName: string;
  status: string | null;
  /** Sum av mengden råvaren brukes med i oppskriften. */
  quantity: number;
  unit: string;
  /** Kostnad for råvaren i oppskriften (mengde × kostpris), når kostpris finnes. */
  lineCost: number | null;
  /** Andel av oppskriftens råvarekost, 0–1. */
  costShare: number | null;
}

interface LineRow {
  recipe_id: string;
  quantity: number | null;
  unit: string | null;
  raw_material_id: string | null;
}

/**
 * Oppskrifter som bruker råvaren (recipe_lines.raw_material_id).
 * Andel av kost regnes mot summen av alle råvarelinjene i samme oppskrift.
 */
export function useRecipesUsingRawMaterial(rawMaterialId: string | undefined, costPerBaseUnit: number | null) {
  return useQuery({
    queryKey: ["recipes-using-raw-material", rawMaterialId, costPerBaseUnit],
    enabled: !!rawMaterialId,
    queryFn: async (): Promise<RecipeUsageRow[]> => {
      const { data: mine, error } = await supabase
        .from("recipe_lines")
        .select("recipe_id, quantity, unit, raw_material_id")
        .eq("raw_material_id", rawMaterialId!)
        .limit(500);
      if (error) throw error;
      const lines = (mine ?? []) as LineRow[];
      if (lines.length === 0) return [];

      const recipeIds = Array.from(new Set(lines.map((l) => l.recipe_id)));

      const [{ data: recipes, error: recErr }, { data: allLines, error: allErr }] = await Promise.all([
        supabase.from("recipes").select("id, name, status").in("id", recipeIds),
        supabase
          .from("recipe_lines")
          .select("recipe_id, quantity, unit, raw_material_id")
          .in("recipe_id", recipeIds)
          .not("raw_material_id", "is", null)
          .limit(5000),
      ]);
      if (recErr) throw recErr;
      if (allErr) throw allErr;

      const rmIds = Array.from(
        new Set(((allLines ?? []) as LineRow[]).map((l) => l.raw_material_id).filter((v): v is string => !!v)),
      );
      const { data: costs, error: costErr } = await supabase
        .from("raw_materials")
        .select("id, current_cost_price")
        .in("id", rmIds);
      if (costErr) throw costErr;
      const costById = new Map<string, number>(
        (costs ?? []).map((c) => [c.id, Number(c.current_cost_price ?? 0)]),
      );

      const recipeTotals = new Map<string, number>();
      for (const l of (allLines ?? []) as LineRow[]) {
        const cost = costById.get(l.raw_material_id ?? "") ?? 0;
        recipeTotals.set(l.recipe_id, (recipeTotals.get(l.recipe_id) ?? 0) + cost * Number(l.quantity ?? 0));
      }

      const byRecipe = new Map<string, { qty: number; unit: string }>();
      for (const l of lines) {
        const cur = byRecipe.get(l.recipe_id) ?? { qty: 0, unit: l.unit ?? "" };
        cur.qty += Number(l.quantity ?? 0);
        byRecipe.set(l.recipe_id, cur);
      }

      const nameById = new Map((recipes ?? []).map((r) => [r.id, r]));
      const cost = costPerBaseUnit ?? costById.get(rawMaterialId!) ?? null;

      return Array.from(byRecipe.entries())
        .map(([recipeId, v]) => {
          const total = recipeTotals.get(recipeId) ?? 0;
          const lineCost = cost != null ? cost * v.qty : null;
          return {
            recipeId,
            recipeName: nameById.get(recipeId)?.name ?? "Uten navn",
            status: nameById.get(recipeId)?.status ?? null,
            quantity: v.qty,
            unit: v.unit,
            lineCost,
            costShare: lineCost != null && total > 0 ? lineCost / total : null,
          };
        })
        .sort((a, b) => (b.costShare ?? 0) - (a.costShare ?? 0) || a.recipeName.localeCompare(b.recipeName, "nb"));
    },
  });
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
