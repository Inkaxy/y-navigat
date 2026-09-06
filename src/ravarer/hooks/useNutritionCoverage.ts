import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { fetchAllRows } from "@/lib/supabasePaging";
import { isNonFoodCategory } from "@/ravarer/lib/matvaretabellenGroups";
import { osloDateISOPlusDays } from "@/lib/osloDate";

export interface CoverageItem {
  raw_material_id: string;
  name: string;
  declaration_name: string | null;
  category: string | null;
  has_nutrition: boolean;
  food_id: string | null;
  recipes_using: number;
  purchase_amount: number;
}

export interface NutritionCoverage {
  total: number;
  withNutrition: number;
  linked: number;
  /** Råvarer uten næringsdata, tyngst brukt først. */
  missing: CoverageItem[];
}

/**
 * Dekningsgrad for næringsdata på matråvarer, med de mest brukte manglende først.
 * Emballasje og forbruksvarer holdes utenfor — de skal aldri ha næringsverdier.
 */
export function useNutritionCoverage() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["nutrition-coverage", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 60_000,
    queryFn: async (): Promise<NutritionCoverage> => {
      const materials = await fetchAllRows<{
        id: string;
        name: string;
        declaration_name: string | null;
        category: string | null;
      }>((from, to) =>
        supabase
          .from("raw_materials")
          .select("id, name, declaration_name, category")
          .eq("legal_entity_id", legalEntityId!)
          .eq("is_active", true)
          .order("name", { ascending: true })
          .range(from, to),
      );

      const foodMaterials = materials.filter((m) => !isNonFoodCategory(m.category));
      const ids = new Set(foodMaterials.map((m) => m.id));

      const nutrition = await fetchAllRows<{
        raw_material_id: string;
        matvaretabellen_food_id: string | null;
        energy_kcal: number | null;
      }>((from, to) =>
        supabase
          .from("raw_material_nutrition")
          .select("raw_material_id, matvaretabellen_food_id, energy_kcal, raw_materials!inner(legal_entity_id)")
          .eq("raw_materials.legal_entity_id", legalEntityId!)
          .range(from, to),
      );

      const recipeLines = await fetchAllRows<{ raw_material_id: string | null; recipe_id: string }>((from, to) =>
        supabase
          .from("recipe_lines")
          .select("raw_material_id, recipe_id")
          .not("raw_material_id", "is", null)
          .range(from, to),
      );

      const since = osloDateISOPlusDays(-365);
      const purchases = await fetchAllRows<{ raw_material_id: string | null; total_amount: number | null }>(
        (from, to) =>
          supabase
            .from("raw_material_purchases")
            .select("raw_material_id, total_amount")
            .eq("legal_entity_id", legalEntityId!)
            .gte("purchase_date", since)
            .range(from, to),
      );

      const nutritionByRm = new Map(nutrition.map((n) => [n.raw_material_id, n]));
      const recipesByRm = new Map<string, Set<string>>();
      for (const line of recipeLines) {
        if (!line.raw_material_id || !ids.has(line.raw_material_id)) continue;
        const set = recipesByRm.get(line.raw_material_id) ?? new Set<string>();
        set.add(line.recipe_id);
        recipesByRm.set(line.raw_material_id, set);
      }
      const amountByRm = new Map<string, number>();
      for (const p of purchases) {
        if (!p.raw_material_id) continue;
        amountByRm.set(p.raw_material_id, (amountByRm.get(p.raw_material_id) ?? 0) + Number(p.total_amount ?? 0));
      }

      const items: CoverageItem[] = foodMaterials.map((m) => {
        const n = nutritionByRm.get(m.id);
        return {
          raw_material_id: m.id,
          name: m.name,
          declaration_name: m.declaration_name,
          category: m.category,
          has_nutrition: !!n && n.energy_kcal != null,
          food_id: n?.matvaretabellen_food_id ?? null,
          recipes_using: recipesByRm.get(m.id)?.size ?? 0,
          purchase_amount: amountByRm.get(m.id) ?? 0,
        };
      });

      const missing = items
        .filter((i) => !i.has_nutrition)
        .sort((a, b) => b.recipes_using - a.recipes_using || b.purchase_amount - a.purchase_amount ||
          a.name.localeCompare(b.name, "nb"));

      return {
        total: items.length,
        withNutrition: items.filter((i) => i.has_nutrition).length,
        linked: items.filter((i) => !!i.food_id).length,
        missing,
      };
    },
  });
}
