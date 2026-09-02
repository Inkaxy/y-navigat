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

/** Koblede produkter for en oppskrift — brukes i statuslinje og koblingslista. */
export interface RecipeLinkedProduct {
  id: string;
  product_id: string;
  is_primary: boolean | null;
  declaration_mode: string | null;
  products: {
    id: string;
    display_name: string | null;
    display_number: string | null;
    breadscale_mode: string | null;
    breadscale_pct: number | null;
    breadscale_value: number | null;
  } | null;
}

export function useRecipeLinkedProducts(recipeId: string | undefined) {
  return useQuery({
    queryKey: ["recipe-linked-products", recipeId],
    enabled: !!recipeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_recipe_links")
        .select(
          "id, product_id, is_primary, declaration_mode, products(id, display_name, display_number, breadscale_mode, breadscale_pct, breadscale_value)",
        )
        .eq("recipe_id", recipeId!);
      if (error) throw error;
      return (data ?? []) as unknown as RecipeLinkedProduct[];
    },
  });
}

/** Oppskriftens effektive grovhet-prosent (manuell eller beregnet, styrt av breadscale_mode). */
export function useRecipeBreadscaleEffective(recipeId: string | undefined) {
  return useQuery({
    queryKey: ["recipe-breadscale-effective", recipeId],
    enabled: !!recipeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("recipe_breadscale_effective", {
        p_recipe_id: recipeId!,
      });
      if (error) throw error;
      return data == null ? null : Number(data);
    },
  });
}

/** Synker grovhet til primærkoblede produkter. Returnerer antall oppdaterte produkter. */
export function useSyncBreadscaleProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) => {
      const { data, error } = await supabase.rpc("breadscale_sync_products_for_recipe", {
        p_recipe_id: recipeId,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (_n, recipeId) => {
      qc.invalidateQueries({ queryKey: ["recipe-linked-products", recipeId] });
      qc.invalidateQueries({ queryKey: ["recipe-breadscale-effective", recipeId] });
    },
  });
}

/** Slår opp visningsnavnet til en bruker (godkjenner av merker o.l.). */
export function useUserDisplayName(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["user-display-name", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", userId!)
        .maybeSingle();
      return data?.display_name ?? null;
    },
  });
}
