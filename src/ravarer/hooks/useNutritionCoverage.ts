import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { fetchAllRows } from "@/lib/supabasePaging";
import { normalizeNutritionSource, type NutritionSource } from "@/ravarer/lib/nutritionSource";
import {
  parseNutritionCoverageSummary,
  sortCoverageRows,
  type CoverageRow,
  type NutritionCoverageSummary,
} from "@/ravarer/lib/nutritionCoverage";

export type NutritionStatus = "complete" | "incomplete" | "missing";

/** Rå rad fra viewet — alle kolonner er nullbare i genererte typer. */
interface RawCoverageViewRow {
  raw_material_id: string | null;
  name: string | null;
  category: string | null;
  status: string | null;
  source: string | null;
  matvaretabellen_food_id: string | null;
  manual_field_count: number | null;
  used_in_recipes: boolean | null;
  recipe_grams: number | null;
  purchase_12m: number | null;
  needs_nutrition: boolean | null;
  is_complete: boolean | null;
  recipe_lines: number | null;
}

interface CoverageViewRow extends CoverageRow {
  is_complete: boolean | null;
  recipe_lines: number | null;
}

export interface CoverageItem {
  raw_material_id: string;
  name: string;
  declaration_name: string | null;
  category: string | null;
  status: NutritionStatus;
  source: NutritionSource | null;
  food_id: string | null;
  recipes_using: number;
  purchase_amount: number;
  safe_to_overwrite: boolean;
  has_nutrition: boolean;
  manual_field_count: number;
}

export interface NutritionCoverage {
  total: number;
  complete: number;
  incomplete: number;
  missing: number;
  linked: number;
  /** Dekning vektet på antall oppskriftslinjer råvarene brukes i. */
  recipeWeighted: { pct: number; covered: number; total: number };
  bySource: Record<"matvaretabellen" | "datablad" | "manuell" | "analyse" | "ukjent", number>;
  candidates: CoverageItem[];
  review: CoverageItem[];
}

const EMPTY_BY_SOURCE = (): NutritionCoverage["bySource"] => ({
  matvaretabellen: 0,
  datablad: 0,
  manuell: 0,
  analyse: 0,
  ukjent: 0,
});

/**
 * Dekningsgrad for næringsdata på matråvarer, lest direkte fra
 * `raw_material_nutrition_coverage`-viewet — ingen klientberegning lenger.
 * Emballasje og forbruksvarer er allerede filtrert bort av `needs_nutrition`.
 */
export function useNutritionCoverage() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["nutrition-coverage", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 60_000,
    queryFn: async (): Promise<NutritionCoverage> => {
      const rows = await fetchAllRows<CoverageViewRow>((from, to) =>
        supabase
          .from("raw_material_nutrition_coverage")
          .select(
            "raw_material_id, name, category, status, source, matvaretabellen_food_id, manual_field_count, used_in_recipes, recipe_grams, recipe_lines, purchase_12m, needs_nutrition, is_complete",
          )
          .eq("legal_entity_id", legalEntityId!)
          .eq("needs_nutrition", true)
          .range(from, to),
      );

      const sorted = sortCoverageRows(rows);
      const items: CoverageItem[] = sorted.map((r) => {
        const source = normalizeNutritionSource(r.source);
        const status: NutritionStatus = r.is_complete ? "complete" : source ? "incomplete" : "missing";
        const safe_to_overwrite = status === "missing" && (source === null || source === "matvaretabellen");
        return {
          raw_material_id: r.raw_material_id,
          name: r.name ?? "",
          category: r.category,
          status,
          source,
          food_id: r.matvaretabellen_food_id,
          recipes_using: r.recipe_lines ?? 0,
          purchase_amount: r.purchase_12m ?? 0,
          safe_to_overwrite,
          has_nutrition: status === "complete",
          manual_field_count: r.manual_field_count ?? 0,
        };
      });

      const bySource = EMPTY_BY_SOURCE();
      for (const i of items) {
        if (i.status === "missing" && !i.source) continue;
        bySource[i.source ?? "ukjent"] += 1;
      }

      return {
        total: items.length,
        complete: items.filter((i) => i.status === "complete").length,
        incomplete: items.filter((i) => i.status === "incomplete").length,
        missing: items.filter((i) => i.status === "missing").length,
        linked: items.filter((i) => !!i.food_id).length,
        bySource,
        candidates: items.filter((i) => i.status === "missing"),
        review: items.filter((i) => i.status === "incomplete"),
      };
    },
  });
}

/** KPI-tallene til dekningssiden — beregnet i databasen, ikke i klienten. */
export function useNutritionCoverageSummary() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["nutrition-coverage-summary", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 60_000,
    queryFn: async (): Promise<NutritionCoverageSummary> => {
      const { data, error } = await supabase.rpc("nutrition_coverage_summary", {
        p_legal_entity_id: legalEntityId!,
      });
      if (error) throw error;
      return parseNutritionCoverageSummary(data);
    },
  });
}
