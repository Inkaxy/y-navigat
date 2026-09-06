import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/supabasePaging";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";

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
      type LinkRow = {
        raw_material_id: string;
        matvaretabellen_food_id: string;
        raw_material: { name: string | null } | null;
      };
      const data = await fetchAllRows<LinkRow>((from, to) =>
        supabase
          .from("raw_material_nutrition")
          .select("raw_material_id, matvaretabellen_food_id, raw_material:raw_materials!inner(name, legal_entity_id)")
          .not("matvaretabellen_food_id", "is", null)
          .eq("raw_material.legal_entity_id", legalEntityId)
          .range(from, to),
      );


      const map = new Map<string, FoodLink[]>();
      for (const row of data ?? []) {
        const foodId = row.matvaretabellen_food_id;
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
    onError: (e: unknown) => toast.error(`Kunne ikke oppdatere: ${e instanceof Error ? e.message : e}`),
  });
}

export function useApplyMatvaretabellen() {
  const qc = useQueryClient();
  return useMutation({
    // `silent` brukes av masse-koblingen: da vises én oppsummering til slutt
    // i stedet for én toast per rad, og vi hopper over ekstra-oppslagene som
    // bare fantes for å pynte på toast-teksten.
    mutationFn: async (input: { rawMaterialId: string; foodId: string; silent?: boolean }) => {
      let declarationNameSet: string | null = null;
      if (!input.silent) {
        const { data: before, error: beforeErr } = await supabase
          .from("raw_materials")
          .select("declaration_name")
          .eq("id", input.rawMaterialId)
          .maybeSingle();
        if (beforeErr) throw beforeErr;
        const { error } = await supabase.rpc("rm_apply_matvaretabellen", {
          p_raw_material_id: input.rawMaterialId,
          p_food_id: input.foodId,
        });
        if (error) throw error;
        if (!before?.declaration_name?.trim()) {
          const { data: after } = await supabase
            .from("raw_materials")
            .select("declaration_name")
            .eq("id", input.rawMaterialId)
            .maybeSingle();
          declarationNameSet = after?.declaration_name?.trim() || null;
        }
      } else {
        const { error } = await supabase.rpc("rm_apply_matvaretabellen", {
          p_raw_material_id: input.rawMaterialId,
          p_food_id: input.foodId,
        });
        if (error) throw error;
      }
      return { ...input, declarationNameSet };
    },
    onSuccess: (input) => {
      invalidateRawMaterial(qc, input.rawMaterialId);
      void qc.invalidateQueries({ queryKey: ["matvaretabellen_links"] });
      void qc.invalidateQueries({ queryKey: ["nutrition-coverage"] });
      if (input.silent) return;
      toast.success(
        input.declarationNameSet
          ? `Næringsverdier hentet fra Matvaretabellen · Deklarasjonsnavn satt til «${input.declarationNameSet}»`
          : "Næringsverdier hentet fra Matvaretabellen",
      );
    },
    onError: (e: unknown, input) => {
      if (input?.silent) return;
      toast.error(`Kunne ikke koble: ${e instanceof Error ? e.message : String(e)}`);
    },
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
    onError: (e: unknown) => toast.error(`Kunne ikke koble fra: ${e instanceof Error ? e.message : e}`),
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
