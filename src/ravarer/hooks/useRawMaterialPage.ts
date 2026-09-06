import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { rmSuppliersQueryOptions, type RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";
import { allergensQueryOptions, nutritionQueryOptions, type AllergenRow, type NutritionRow } from "@/ravarer/hooks/useNutrition";
import { datasheetsQueryOptions, type DatasheetListRow } from "@/ravarer/hooks/useDatasheets";

export interface RawMaterialPageData {
  rm: RawMaterialRow | null;
  links: RmSupplierRow[];
  nutrition: NutritionRow | null;
  allergens: AllergenRow[];
  datasheets: DatasheetListRow[];
  hasNutrition: boolean;
  hasDatasheet: boolean;
  allergenCount: number;
  recipeCount: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Én felles henting for hele råvaredetaljen. Hver nøkkel har NØYAKTIG samme
 * datakontrakt som den enkeltstående hooken (komplette rader) — KPI-statuser og
 * tellere utledes lokalt her. Legger vi en boolean eller et tall i en delt
 * nøkkel, får fanene feil type fra cachen og krasjer (f.eks. `allergens.find`).
 */
export function useRawMaterialPage(id: string | undefined): RawMaterialPageData {
  const results = useQueries({
    queries: [
      {
        queryKey: ["raw_material", id],
        enabled: !!id,
        queryFn: async () => {
          const { data, error } = await supabase.from("raw_materials").select("*").eq("id", id!).maybeSingle();
          if (error) throw error;
          return (data ?? null) as RawMaterialRow | null;
        },
      },
      rmSuppliersQueryOptions(id),
      nutritionQueryOptions(id),
      datasheetsQueryOptions(id),
      allergensQueryOptions(id),
      {
        queryKey: ["recipe-usage-count", id],
        enabled: !!id,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("recipe_lines")
            .select("recipe_id")
            .eq("raw_material_id", id!)
            .limit(1000);
          if (error) throw error;
          return new Set((data ?? []).map((r) => r.recipe_id)).size;
        },
      },
    ],
  });

  const [rmQ, linksQ, nutritionQ, datasheetQ, allergenQ, recipeQ] = results;

  const nutrition = (nutritionQ.data as NutritionRow | null | undefined) ?? null;
  const allergens = (allergenQ.data as AllergenRow[] | undefined) ?? [];
  const datasheets = (datasheetQ.data as DatasheetListRow[] | undefined) ?? [];

  // Feil fra hvilken som helst av delspørringene skal vises, ikke bare råvaren.
  const failed = results.find((r) => r.isError);

  return {
    rm: (rmQ.data as RawMaterialRow | null | undefined) ?? null,
    links: (linksQ.data as RmSupplierRow[] | undefined) ?? [],
    nutrition,
    allergens,
    datasheets,
    hasNutrition: nutrition != null,
    hasDatasheet: datasheets.some((d) => d.is_current === true),
    allergenCount: allergens.length,
    recipeCount: (recipeQ.data as number | undefined) ?? 0,
    isLoading: results.some((r) => r.isLoading),
    isError: !!failed,
    error: failed?.error ?? null,
    refetch: () => {
      for (const r of results) void r.refetch();
    },
  };
}
