import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Utfall av etterberegningen: `none` = ingen oppskrifter bruker råvaren; `failed` = oppslag/alle feilet. */
export type RecomputeStatus = "none" | "done" | "partial" | "failed";
export interface RecomputeResult { status: RecomputeStatus; ok: number; total: number; failedRecipeIds: string[] }

/**
 * Detaljert etterberegning for én (frosset) råvare-ID. Skiller «ingenting å gjøre» fra «feilet»,
 * så en bekreftet råvarelagring kan rapportere en mislykket etterberegning separat.
 * Selve beregningen autoriseres av `compute-recipe-label` (lesetilgang til oppskriften).
 */
export async function recomputeRecipesDetailed(rawMaterialId: string, qc?: QueryClient): Promise<RecomputeResult> {
  let recipeIds: string[];
  try {
    const { data, error } = await supabase
      .from("recipe_lines")
      .select("recipe_id")
      .eq("raw_material_id", rawMaterialId)
      .limit(500);
    if (error) throw error;
    recipeIds = Array.from(
      new Set(((data ?? []) as { recipe_id: string | null }[]).map((r) => r.recipe_id).filter((v): v is string => !!v)),
    );
  } catch (e) {
    console.error("recomputeRecipesForRawMaterial", e);
    return { status: "failed", ok: 0, total: 0, failedRecipeIds: [] };
  }
  if (recipeIds.length === 0) return { status: "none", ok: 0, total: 0, failedRecipeIds: [] };

  let ok = 0;
  const failed: string[] = [];
  for (const recipeId of recipeIds) {
    try {
      const { error: fnErr } = await supabase.functions.invoke("compute-recipe-label", { body: { recipe_id: recipeId } });
      if (fnErr) throw fnErr;
    } catch (e) {
      console.error("compute-recipe-label", recipeId, e);
      failed.push(recipeId);
      continue;
    }
    ok++;
    qc?.invalidateQueries({ queryKey: ["recipe-label-calculated", recipeId] });
    qc?.invalidateQueries({ queryKey: ["recipe-label-sources", recipeId] });
    qc?.invalidateQueries({ queryKey: ["recipe-breadscale-effective", recipeId] });
  }
  qc?.invalidateQueries({ queryKey: ["recipes"] });
  return { status: failed.length === 0 ? "done" : ok > 0 ? "partial" : "failed", ok, total: recipeIds.length, failedRecipeIds: failed };
}

/**
 * Etter en råvareendring: finn oppskriftene som bruker råvaren og beregn
 * merkedata på nytt i bakgrunnen. Feil her skal aldri velte lagringen.
 * (Uendret kontrakt for eksisterende kallere: antall vellykkede.)
 */
export async function recomputeRecipesForRawMaterial(
  rawMaterialId: string,
  qc?: QueryClient,
  options?: { silent?: boolean },
): Promise<number> {
  const r = await recomputeRecipesDetailed(rawMaterialId, qc);
  if (r.ok > 0 && !options?.silent) {
    toast.success(`${r.ok} ${r.ok === 1 ? "oppskrift" : "oppskrifter"} beregnet på nytt`);
  }
  return r.ok;
}
