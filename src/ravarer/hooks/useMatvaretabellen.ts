import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/supabasePaging";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { recomputeRecipesForRawMaterial } from "@/varer/lib/recomputeFanout";
import { escapeIlikePattern, normalizeForServerSearch } from "@/ravarer/lib/textNormalize";

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

export interface FoodSuggestionRow {
  food_id: string;
  food_name: string;
  food_group_name: string | null;
  score: number;
}

/** Forslag under denne tilliten vises ikke — for usikkert til å foreslås. */
export const SUGGEST_MIN_SCORE = 0.4;

/** Foreslåtte matvarer for en KJENT råvare, rangert av databasen selv. */
export function useMatvaretabellenSuggest(rawMaterialId: string | null | undefined) {
  return useQuery({
    queryKey: ["matvaretabellen_suggest", rawMaterialId],
    enabled: !!rawMaterialId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<FoodSuggestionRow[]> => {
      const { data, error } = await supabase.rpc("matvaretabellen_suggest", {
        p_raw_material_id: rawMaterialId!,
        p_limit: 5,
      });
      if (error) throw error;
      return ((data ?? []) as FoodSuggestionRow[]).filter((r) => r.score >= SUGGEST_MIN_SCORE);
    },
  });
}

export interface SuggestForNameInput {
  name: string;
  declarationName?: string | null;
  category?: string | null;
}

/** Foreslåtte matvarer for en ULAGRET råvare — bare navn/deklarasjon/kategori finnes ennå. */
export function useMatvaretabellenSuggestForName(input: SuggestForNameInput | null) {
  return useQuery({
    queryKey: ["matvaretabellen_suggest_for_name", input?.name, input?.declarationName, input?.category],
    enabled: !!input?.name?.trim(),
    staleTime: 60 * 1000,
    queryFn: async (): Promise<FoodSuggestionRow[]> => {
      const { data, error } = await supabase.rpc("matvaretabellen_suggest_for_name", {
        p_name: input!.name,
        p_declaration_name: input?.declarationName || undefined,
        p_category: input?.category || undefined,
        p_limit: 5,
      });
      if (error) throw error;
      return ((data ?? []) as FoodSuggestionRow[]).filter((r) => r.score >= SUGGEST_MIN_SCORE);
    },
  });
}

export interface SearchFoodRow {
  food_id: string;
  food_name: string;
  food_group_name: string | null;
  energy_kcal: number | null;
  search_keywords: string[] | null;
}

/**
 * Fritekstsøk mot Matvaretabellen, server-side — henter ALDRI hele tabellen.
 * Normaliserer søket likt kolonnene `food_name_norm`/`search_keywords_norm`.
 */
export function useMatvaretabellenSearch(query: string) {
  const needle = normalizeForServerSearch(query);
  return useQuery({
    queryKey: ["matvaretabellen_search", needle],
    enabled: needle.length >= 2,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<SearchFoodRow[]> => {
      const pattern = `*${escapeIlikePattern(needle)}*`;
      const { data, error } = await supabase
        .from("matvaretabellen_foods")
        .select("food_id, food_name, food_group_name, energy_kcal, search_keywords")
        .or(`food_name_norm.ilike.${pattern},search_keywords_norm.ilike.${pattern}`)
        .eq("is_stale", false)
        .order("food_name", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SearchFoodRow[];
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

export interface ApplyMatvaretabellenResult {
  written: string[];
  skipped: string[];
  water_content_set: boolean;
  water_g_skipped: boolean;
  declaration_name_set: string | null;
  forced: boolean;
}

export function useApplyMatvaretabellen() {
  const qc = useQueryClient();
  return useMutation({
    // `silent` brukes av masse-koblingen: da vises én oppsummering til slutt
    // i stedet for én toast per rad. `force` overskriver felt som RPC-en
    // ellers ville beholdt fordi de kommer fra et datablad eller er rettet manuelt.
    mutationFn: async (input: { rawMaterialId: string; foodId: string; silent?: boolean; force?: boolean }) => {
      const { data, error } = await supabase.rpc("rm_apply_matvaretabellen", {
        p_raw_material_id: input.rawMaterialId,
        p_food_id: input.foodId,
        p_force: input.force ?? false,
      });
      if (error) throw error;
      return { ...input, result: (data ?? null) as unknown as ApplyMatvaretabellenResult };
    },
    onSuccess: (input) => {
      invalidateRawMaterial(qc, input.rawMaterialId);
      void qc.invalidateQueries({ queryKey: ["matvaretabellen_links"] });
      void qc.invalidateQueries({ queryKey: ["nutrition-coverage"] });
      // Oppskriftene som bruker råvaren beregnes på nytt i bakgrunnen.
      void recomputeRecipesForRawMaterial(input.rawMaterialId, qc, { silent: input.silent });
      if (input.silent) return;
      const declarationNameSet = input.result?.declaration_name_set ?? null;
      toast.success(
        declarationNameSet
          ? `Næringsverdier hentet fra Matvaretabellen · Deklarasjonsnavn satt til «${declarationNameSet}»`
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
