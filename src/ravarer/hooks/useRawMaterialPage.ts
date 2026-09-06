import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import type { RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";

export interface RawMaterialPageData {
  rm: RawMaterialRow | null;
  links: RmSupplierRow[];
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
 * Én felles henting for hele råvaredetaljen: råvaren, leverandørkoblingene og
 * statusene som KPI-stripa og fanene trenger — i parallell, med de samme
 * query-nøklene som de enkeltstående hookene, slik at invalidering treffer.
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
      {
        queryKey: ["raw_material_suppliers", id],
        enabled: !!id,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("raw_material_suppliers")
            .select("*")
            .eq("raw_material_id", id!)
            .order("is_primary", { ascending: false });
          if (error) throw error;
          return (data ?? []) as RmSupplierRow[];
        },
      },
      {
        queryKey: ["raw_material_nutrition", id],
        enabled: !!id,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("raw_material_nutrition")
            .select("raw_material_id")
            .eq("raw_material_id", id!)
            .maybeSingle();
          if (error) throw error;
          return !!data;
        },
      },
      {
        queryKey: ["raw-material-datasheets", id, "current"],
        enabled: !!id,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("raw_material_datasheets")
            .select("id")
            .eq("raw_material_id", id!)
            .eq("is_current", true)
            .limit(1);
          if (error) throw error;
          return (data ?? []).length > 0;
        },
      },
      {
        queryKey: ["raw_material_allergens", id],
        enabled: !!id,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("raw_material_allergens")
            .select("allergen")
            .eq("raw_material_id", id!)
            .limit(200);
          if (error) throw error;
          return (data ?? []).length;
        },
      },
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

  return {
    rm: (rmQ.data as RawMaterialRow | null | undefined) ?? null,
    links: (linksQ.data as RmSupplierRow[] | undefined) ?? [],
    hasNutrition: (nutritionQ.data as boolean | undefined) ?? false,
    hasDatasheet: (datasheetQ.data as boolean | undefined) ?? false,
    allergenCount: (allergenQ.data as number | undefined) ?? 0,
    recipeCount: (recipeQ.data as number | undefined) ?? 0,
    isLoading: rmQ.isLoading,
    isError: rmQ.isError,
    error: rmQ.error,
    refetch: () => {
      for (const r of results) void r.refetch();
    },
  };
}
