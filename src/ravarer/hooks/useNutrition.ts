import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type AllergenCode = Database["public"]["Enums"]["allergen_type"];

export interface NutritionRow {
  raw_material_id: string;
  energy_kj: number | null;
  energy_kcal: number | null;
  fat_g: number | null;
  saturated_fat_g: number | null;
  carbs_g: number | null;
  sugars_g: number | null;
  fiber_g: number | null;
  protein_g: number | null;
  salt_g: number | null;
  ingredient_declaration: string | null;
  country_of_origin: string | null;
  e_numbers: string[] | null;
  source: string | null;
  matvaretabellen_food_id?: string | null;
  source_document_url: string | null;
  verified_at: string | null;
  verified_by: string | null;
}

export interface AllergenRow {
  id: string;
  raw_material_id: string;
  allergen: string;
  presence: "contains" | "may_contain" | "free_from";
}

/**
 * Én datakontrakt per query-nøkkel: alle som bruker ["raw_material_nutrition", id]
 * må hente HELE raden. Statuser (finnes/mangler) utledes lokalt, aldri ved å
 * legge en boolean i samme cache-nøkkel.
 */
export function nutritionQueryOptions(rawMaterialId: string | undefined) {
  return {
    queryKey: ["raw_material_nutrition", rawMaterialId] as const,
    enabled: !!rawMaterialId,
    queryFn: async (): Promise<NutritionRow | null> => {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .select("*")
        .eq("raw_material_id", rawMaterialId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as NutritionRow | null;
    },
  };
}

export function useNutrition(rawMaterialId: string | undefined) {
  return useQuery(nutritionQueryOptions(rawMaterialId));
}

export function useUpsertNutrition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<NutritionRow> & { raw_material_id: string }) => {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .upsert(input, { onConflict: "raw_material_id" })
        .select()
        .single();
      if (error) throw error;
      return data as NutritionRow;
    },
    onSuccess: (data: NutritionRow) => {
      qc.invalidateQueries({ queryKey: ["raw_material_nutrition", data.raw_material_id] });
      toast.success("Næringsinnhold lagret");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke lagre: ${e instanceof Error ? e.message : String(e)}`),
  });
}

/** Samme kontrakt for ["raw_material_allergens", id]: alltid komplette rader. */
export function allergensQueryOptions(rawMaterialId: string | undefined) {
  return {
    queryKey: ["raw_material_allergens", rawMaterialId] as const,
    enabled: !!rawMaterialId,
    queryFn: async (): Promise<AllergenRow[]> => {
      const { data, error } = await supabase
        .from("raw_material_allergens")
        .select("*")
        .eq("raw_material_id", rawMaterialId!);
      if (error) throw error;
      return (data ?? []) as AllergenRow[];
    },
  };
}

export function useAllergens(rawMaterialId: string | undefined) {
  return useQuery(allergensQueryOptions(rawMaterialId));
}

export function useSetAllergen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      raw_material_id: string;
      allergen: string;
      presence: "contains" | "may_contain" | "free_from" | null;
    }) => {
      if (input.presence === null) {
        const { error } = await supabase
          .from("raw_material_allergens")
          .delete()
          .eq("raw_material_id", input.raw_material_id)
          .eq("allergen", input.allergen as AllergenCode);
        if (error) throw error;
        return null;
      }
      const { data, error } = await supabase
        .from("raw_material_allergens")
        .upsert(
          {
            raw_material_id: input.raw_material_id,
            allergen: input.allergen as AllergenCode,
            presence: input.presence,
          },
          { onConflict: "raw_material_id,allergen" },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["raw_material_allergens", vars.raw_material_id] });
    },
    onError: (e: unknown) =>
      toast.error(`Kunne ikke lagre allergen: ${e instanceof Error ? e.message : String(e)}`),
  });
}
