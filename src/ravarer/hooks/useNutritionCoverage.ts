import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { fetchAllRows } from "@/lib/supabasePaging";
import { isNonFoodCategory } from "@/ravarer/lib/matvaretabellenGroups";
import { normalizeNutritionSource, type NutritionSource } from "@/ravarer/lib/nutritionSource";
import { osloDateISOPlusDays } from "@/lib/osloDate";

/**
 * Feltene en næringsdeklarasjon må ha for å kunne kalles fullstendig.
 * Fiber er frivillig etter matinformasjonsforskriften og teller derfor ikke.
 * Merk: 0 er en gyldig verdi (f.eks. sukker i olje) — vi sjekker alltid mot
 * null, aldri mot falsy.
 */
export const REQUIRED_NUTRITION_FIELDS = [
  "energy_kj",
  "energy_kcal",
  "fat_g",
  "saturated_fat_g",
  "carbs_g",
  "sugars_g",
  "protein_g",
  "salt_g",
] as const;

export type NutritionStatus = "complete" | "incomplete" | "missing";

export interface CoverageItem {
  raw_material_id: string;
  name: string;
  declaration_name: string | null;
  category: string | null;
  /** Finnes det i det hele tatt en næringsrad? */
  has_row: boolean;
  status: NutritionStatus;
  /** Normalisert kilde på raden, null når raden mangler. */
  source: NutritionSource | null;
  /** Påkrevde felt som fortsatt er tomme. */
  missing_fields: string[];
  food_id: string | null;
  recipes_using: number;
  purchase_amount: number;
  /** true = ingen verdier å miste, trygt å fylle fra Matvaretabellen i bulk. */
  safe_to_overwrite: boolean;
  /** Kompatibilitet: fullstendig næring. */
  has_nutrition: boolean;
}

export interface NutritionCoverage {
  total: number;
  complete: number;
  incomplete: number;
  missing: number;
  linked: number;
  /** Antall råvarer per kilde. */
  bySource: Record<"matvaretabellen" | "datablad" | "manuell" | "analyse" | "ukjent", number>;
  /** Dekning vektet på hvor mange oppskrifter råvaren brukes i. */
  recipeWeighted: { covered: number; total: number; pct: number };
  /** Uten næringsdata i det hele tatt — kan kobles i bulk. */
  candidates: CoverageItem[];
  /** Har data, men ufullstendig — må gjennomgås manuelt. */
  review: CoverageItem[];
}

const EMPTY_BY_SOURCE = (): NutritionCoverage["bySource"] => ({
  matvaretabellen: 0,
  datablad: 0,
  manuell: 0,
  analyse: 0,
  ukjent: 0,
});

type NutritionLite = Record<string, unknown> & {
  raw_material_id: string;
  matvaretabellen_food_id: string | null;
  source: string | null;
};

function classify(n: NutritionLite | undefined): {
  status: NutritionStatus;
  missing_fields: string[];
} {
  if (!n) return { status: "missing", missing_fields: [...REQUIRED_NUTRITION_FIELDS] };
  const missing_fields = REQUIRED_NUTRITION_FIELDS.filter((f) => n[f] == null);
  if (missing_fields.length === 0) return { status: "complete", missing_fields };
  if (missing_fields.length === REQUIRED_NUTRITION_FIELDS.length) return { status: "missing", missing_fields };
  return { status: "incomplete", missing_fields };
}

/**
 * Dekningsgrad for næringsdata på matråvarer, med de mest brukte manglende først.
 * Emballasje og forbruksvarer holdes utenfor — de skal aldri ha næringsverdier.
 */
export function useNutritionCoverage() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["nutrition-coverage", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 60_000,
    queryFn: async (): Promise<NutritionCoverage> => {
      const materials = await fetchAllRows<{
        id: string;
        name: string;
        declaration_name: string | null;
        category: string | null;
      }>((from, to) =>
        supabase
          .from("raw_materials")
          .select("id, name, declaration_name, category")
          .eq("legal_entity_id", legalEntityId!)
          .eq("is_active", true)
          .order("name", { ascending: true })
          .range(from, to),
      );

      const foodMaterials = materials.filter((m) => !isNonFoodCategory(m.category));
      const ids = new Set(foodMaterials.map((m) => m.id));

      const nutrition = await fetchAllRows<NutritionLite>((from, to) =>
        supabase
          .from("raw_material_nutrition")
          .select(
            "raw_material_id, matvaretabellen_food_id, source, energy_kj, energy_kcal, fat_g, saturated_fat_g, carbs_g, sugars_g, protein_g, salt_g, fiber_g, raw_materials!inner(legal_entity_id)",
          )
          .eq("raw_materials.legal_entity_id", legalEntityId!)
          .range(from, to),
      );

      const recipeLines = await fetchAllRows<{ raw_material_id: string | null; recipe_id: string }>((from, to) =>
        supabase
          .from("recipe_lines")
          .select("raw_material_id, recipe_id")
          .not("raw_material_id", "is", null)
          .range(from, to),
      );

      const since = osloDateISOPlusDays(-365);
      const purchases = await fetchAllRows<{ raw_material_id: string | null; total_amount: number | null }>(
        (from, to) =>
          supabase
            .from("raw_material_purchases")
            .select("raw_material_id, total_amount")
            .eq("legal_entity_id", legalEntityId!)
            .gte("purchase_date", since)
            .range(from, to),
      );

      const nutritionByRm = new Map(nutrition.map((n) => [n.raw_material_id, n]));
      const recipesByRm = new Map<string, Set<string>>();
      for (const line of recipeLines) {
        if (!line.raw_material_id || !ids.has(line.raw_material_id)) continue;
        const set = recipesByRm.get(line.raw_material_id) ?? new Set<string>();
        set.add(line.recipe_id);
        recipesByRm.set(line.raw_material_id, set);
      }
      const amountByRm = new Map<string, number>();
      for (const p of purchases) {
        if (!p.raw_material_id) continue;
        amountByRm.set(p.raw_material_id, (amountByRm.get(p.raw_material_id) ?? 0) + Number(p.total_amount ?? 0));
      }

      const items: CoverageItem[] = foodMaterials.map((m) => {
        const n = nutritionByRm.get(m.id);
        const { status, missing_fields } = classify(n);
        const source = n ? normalizeNutritionSource(n.source) : null;
        // Trygt å fylle automatisk bare når ingen har lagt inn noe fra før:
        // et datablad eller en manuell verdi skal aldri overskrives av en bulk-kobling.
        const safe_to_overwrite = status === "missing" && (source === null || source === "matvaretabellen");
        return {
          raw_material_id: m.id,
          name: m.name,
          declaration_name: m.declaration_name,
          category: m.category,
          has_row: !!n,
          status,
          source,
          missing_fields,
          food_id: n?.matvaretabellen_food_id ?? null,
          recipes_using: recipesByRm.get(m.id)?.size ?? 0,
          purchase_amount: amountByRm.get(m.id) ?? 0,
          safe_to_overwrite,
          has_nutrition: status === "complete",
        };
      });

      const byWeight = (a: CoverageItem, b: CoverageItem) =>
        b.recipes_using - a.recipes_using ||
        b.purchase_amount - a.purchase_amount ||
        a.name.localeCompare(b.name, "nb");

      const bySource = EMPTY_BY_SOURCE();
      for (const i of items) {
        if (!i.has_row) continue;
        bySource[i.source ?? "ukjent"] += 1;
      }

      const recipeTotal = items.reduce((s, i) => s + i.recipes_using, 0);
      const recipeCovered = items.reduce((s, i) => s + (i.status === "complete" ? i.recipes_using : 0), 0);

      return {
        total: items.length,
        complete: items.filter((i) => i.status === "complete").length,
        incomplete: items.filter((i) => i.status === "incomplete").length,
        missing: items.filter((i) => i.status === "missing").length,
        linked: items.filter((i) => !!i.food_id).length,
        bySource,
        recipeWeighted: {
          covered: recipeCovered,
          total: recipeTotal,
          pct: recipeTotal > 0 ? Math.round((recipeCovered / recipeTotal) * 100) : 0,
        },
        candidates: items.filter((i) => i.status === "missing").sort(byWeight),
        review: items.filter((i) => i.status === "incomplete").sort(byWeight),
      };
    },
  });
}
