import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Etter en råvareendring: finn oppskriftene som bruker råvaren og beregn
 * merkedata på nytt i bakgrunnen. Feil her skal aldri velte lagringen.
 */
export async function recomputeRecipesForRawMaterial(
  rawMaterialId: string,
  qc?: QueryClient,
  options?: { silent?: boolean },
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("recipe_lines")
      .select("recipe_id")
      .eq("raw_material_id", rawMaterialId)
      .limit(500);
    if (error) throw error;

    const recipeIds = Array.from(
      new Set(((data ?? []) as { recipe_id: string | null }[]).map((r) => r.recipe_id).filter((v): v is string => !!v)),
    );
    if (recipeIds.length === 0) return 0;

    let ok = 0;
    for (const recipeId of recipeIds) {
      const { error: fnErr } = await supabase.functions.invoke("compute-recipe-label", {
        body: { recipe_id: recipeId },
      });
      if (fnErr) {
        console.error("compute-recipe-label", recipeId, fnErr);
        continue;
      }
      ok++;
      qc?.invalidateQueries({ queryKey: ["recipe-label-calculated", recipeId] });
      qc?.invalidateQueries({ queryKey: ["recipe-label-sources", recipeId] });
      qc?.invalidateQueries({ queryKey: ["recipe-breadscale-effective", recipeId] });
    }
    qc?.invalidateQueries({ queryKey: ["recipes"] });
    if (ok > 0 && !options?.silent) {
      toast.success(`${ok} ${ok === 1 ? "oppskrift" : "oppskrifter"} beregnet på nytt`);
    }
    return ok;
  } catch (e) {
    console.error("recomputeRecipesForRawMaterial", e);
    return 0;
  }
}
