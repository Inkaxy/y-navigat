import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/supabasePaging";

export interface FoodRow {
  food_id: string;
  food_name: string;
  latin_name: string | null;
  food_group_id: string | null;
  food_group_name: string | null;
  energy_kj: number | null;
  energy_kcal: number | null;
  fat_g: number | null;
  saturated_fat_g: number | null;
  carbs_g: number | null;
  sugars_g: number | null;
  starch_g: number | null;
  fiber_g: number | null;
  protein_g: number | null;
  salt_g: number | null;
  water_g: number | null;
  edible_part_pct: number | null;
  search_keywords: string[] | null;
  uri: string | null;
  synced_at: string | null;
}

/** Hele matvaretabellen (~2 100 rader) — hentes én gang og filtreres i klienten. */
export function useMatvaretabellenFoods() {
  return useQuery({
    queryKey: ["matvaretabellen_foods"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAllRows<FoodRow>((from, to) =>
        supabase
          .from("matvaretabellen_foods")
          .select(
            "food_id, food_name, latin_name, food_group_id, food_group_name, energy_kj, energy_kcal, fat_g, saturated_fat_g, carbs_g, sugars_g, starch_g, fiber_g, protein_g, salt_g, water_g, edible_part_pct, search_keywords, uri, synced_at",
          )
          .order("food_name", { ascending: true })
          .range(from, to),
      );
      return rows;
    },
  });
}

export interface FoodLink {
  food_id: string;
  raw_material_id: string;
  raw_material_name: string;
}

/** Hvilke råvarer som er koblet til hvilke matvarer, for gjeldende selskap. */
export function useMatvaretabellenLinks() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["matvaretabellen_links", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .select("raw_material_id, matvaretabellen_food_id, raw_material:raw_materials!inner(name, legal_entity_id)")
        .not("matvaretabellen_food_id", "is", null)
        .eq("raw_materials.legal_entity_id", legalEntityId);
      if (error) throw error;

      const map = new Map<string, FoodLink[]>();
      for (const row of (data ?? []) as any[]) {
        const foodId = row.matvaretabellen_food_id as string;
        const list = map.get(foodId) ?? [];
        list.push({
          food_id: foodId,
          raw_material_id: row.raw_material_id,
          raw_material_name: row.raw_material?.name ?? "Ukjent råvare",
        });
        map.set(foodId, list);
      }
      return map;
    },
  });
}

export function useSyncMatvaretabellen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("matvaretabellen-sync");
      if (error) throw error;
      return data as { ok: boolean; foods: number; upserted: number; groups: number };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["matvaretabellen_foods"] });
      toast.success(`Matvaretabellen oppdatert — ${res?.upserted ?? 0} matvarer lagret`);
    },
    onError: (e: any) => toast.error(`Kunne ikke oppdatere: ${e.message ?? e}`),
  });
}

export function useApplyMatvaretabellen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rawMaterialId: string; foodId: string }) => {
      const { error } = await supabase.rpc("rm_apply_matvaretabellen", {
        p_raw_material_id: input.rawMaterialId,
        p_food_id: input.foodId,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      qc.invalidateQueries({ queryKey: ["matvaretabellen_links"] });
      qc.invalidateQueries({ queryKey: ["raw_material_nutrition", input.rawMaterialId] });
      qc.invalidateQueries({ queryKey: ["raw_material", input.rawMaterialId] });
      toast.success("Næringsverdier hentet fra Matvaretabellen");
    },
    onError: (e: any) => toast.error(`Kunne ikke koble: ${e.message ?? e}`),
  });
}

export function useUnlinkMatvaretabellen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rawMaterialId: string) => {
      const { error } = await supabase.rpc("rm_unlink_matvaretabellen", { p_raw_material_id: rawMaterialId });
      if (error) throw error;
      return rawMaterialId;
    },
    onSuccess: (rawMaterialId) => {
      qc.invalidateQueries({ queryKey: ["matvaretabellen_links"] });
      qc.invalidateQueries({ queryKey: ["raw_material_nutrition", rawMaterialId] });
      toast.success("Koblingen til Matvaretabellen er fjernet");
    },
    onError: (e: any) => toast.error(`Kunne ikke koble fra: ${e.message ?? e}`),
  });
}

/** Én matvare — brukes på råvarekortet for å vise navn og lenke. */
export function useMatvaretabellenFood(foodId: string | null | undefined) {
  return useQuery({
    queryKey: ["matvaretabellen_food", foodId],
    enabled: !!foodId,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matvaretabellen_foods")
        .select("food_id, food_name, food_group_name, uri")
        .eq("food_id", foodId!)
        .maybeSingle();
      if (error) throw error;
      return data as Pick<FoodRow, "food_id" | "food_name" | "food_group_name" | "uri"> | null;
    },
  });
}
