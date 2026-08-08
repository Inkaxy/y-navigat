import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type RecipeLabelCalculated = {
  recipe_id: string;
  computed_at: string;
  total_input_grams: number | null;
  final_weight_grams: number | null;
  dry_matter_grams: number | null;
  dry_matter_pct: number | null;
  flour_grams: number | null;
  whole_grain_grams: number | null;
  whole_grain_pct_of_dry: number | null;
  grain_score_pct: number | null;
  grain_category: string | null;
  rye_share_of_grain_pct: number | null;
  nutrition_per_100g: Record<string, number | null> | null;
  ingredient_declaration: string | null;
  allergens: { contains?: string[]; may_contain?: string[] } | null;
  keyhole: any | null;
  coverage_by_weight_pct: number | null;
  missing_data: any | null;
  warnings: string[] | null;
};

/** Lagret beregning for en oppskrift. */
export function useRecipeLabelCalculated(recipeId: string | undefined) {
  return useQuery({
    queryKey: ["recipe-label-calculated", recipeId],
    enabled: !!recipeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_label_calculated")
        .select("*")
        .eq("recipe_id", recipeId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as RecipeLabelCalculated | null;
    },
  });
}

/** Kjører compute-recipe-label og oppdaterer cachen. */
export function useComputeRecipeLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) => {
      const { data, error } = await supabase.functions.invoke("compute-recipe-label", {
        body: { recipe_id: recipeId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as RecipeLabelCalculated;
    },
    onSuccess: (_d, recipeId) => {
      qc.invalidateQueries({ queryKey: ["recipe-label-calculated", recipeId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke beregne merkedata"),
  });
}
