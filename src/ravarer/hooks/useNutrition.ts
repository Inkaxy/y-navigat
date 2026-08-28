import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

export function useNutrition(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw_material_nutrition", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .select("*")
        .eq("raw_material_id", rawMaterialId!)
        .maybeSingle();
      if (error) throw error;
      return data as NutritionRow | null;
    },
  });
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
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["raw_material_nutrition", data.raw_material_id] });
      toast.success("Næringsinnhold lagret");
    },
    onError: (e: any) => toast.error(`Kunne ikke lagre: ${e.message ?? e}`),
  });
}

export function useAllergens(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw_material_allergens", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_allergens")
        .select("*")
        .eq("raw_material_id", rawMaterialId!);
      if (error) throw error;
      return (data ?? []) as AllergenRow[];
    },
  });
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
          .eq("allergen", input.allergen as any);
        if (error) throw error;
        return null;
      }
      const { data, error } = await supabase
        .from("raw_material_allergens")
        .upsert(
          {
            raw_material_id: input.raw_material_id,
            allergen: input.allergen as any,
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
    onError: (e: any) => toast.error(`Kunne ikke lagre allergen: ${e.message ?? e}`),
  });
}
