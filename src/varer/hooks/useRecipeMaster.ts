import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Henter master-oppskrift med linjer, arbeidskost, emballasje og koblede produkter.
 */
export function useRecipeMaster(recipeId: string | undefined) {
  return useQuery({
    queryKey: ["recipe-master", recipeId],
    enabled: !!recipeId,
    queryFn: async () => {
      const [recipe, lines, labor, packaging, links] = await Promise.all([
        supabase.from("recipes").select("*").eq("id", recipeId!).maybeSingle(),
        supabase
          .from("recipe_lines")
          .select("*, raw_materials(id, sku, name, base_unit, current_cost_price)")
          .eq("recipe_id", recipeId!)
          .order("sort_order"),
        supabase.from("recipe_labor_lines").select("*").eq("recipe_id", recipeId!).order("sort_order"),
        supabase
          .from("recipe_packaging_lines")
          .select("*, raw_materials(id, sku, name, current_cost_price)")
          .eq("recipe_id", recipeId!)
          .order("sort_order"),
        supabase
          .from("product_recipe_links")
          .select("*, products(id, display_name, display_number, status)")
          .eq("recipe_id", recipeId!),
      ]);
      return {
        recipe: recipe.data,
        lines: lines.data ?? [],
        labor: labor.data ?? [],
        packaging: packaging.data ?? [],
        links: links.data ?? [],
      };
    },
  });
}

/**
 * Finn (eller opprett) primær oppskrift-link for et produkt.
 */
export function useProductRecipeLink(productId: string | undefined) {
  return useQuery({
    queryKey: ["product-recipe-link", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data } = await supabase
        .from("product_recipe_links")
        .select("*, recipes(id, name, version, units_per_batch, hourly_rate, target_db_pct, price_netto, price_engros, price_engros_with_packaging, price_egne_utsalg)")
        .eq("product_id", productId!)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
}

export function useUnlinkProductFromRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.from("product_recipe_links").delete().eq("id", linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe-master"] });
      qc.invalidateQueries({ queryKey: ["product-recipe-link"] });
      toast.success("Produkt frakoblet");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useLinkProductToRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { product_id: string; recipe_id: string }) => {
      const { error } = await supabase
        .from("product_recipe_links")
        .insert({ product_id: input.product_id, recipe_id: input.recipe_id, is_primary: true } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe-master"] });
      qc.invalidateQueries({ queryKey: ["product-recipe-link"] });
      toast.success("Produkt koblet til oppskrift");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
