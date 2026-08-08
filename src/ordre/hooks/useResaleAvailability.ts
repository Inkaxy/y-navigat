import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AvailabilityInfo {
  raw_material_id: string;
  raw_material_name: string;
  /** Disponibelt omregnet til varens salgsenhet. */
  available_sold_units: number;
  base_unit: string;
}

/**
 * Disponibelt lager for handelsvarer koblet til de gitte varene.
 * Brukes til en rolig advarsel ved ordrelinjer — blokkerer aldri.
 */
export function useResaleAvailability(productIds: string[]) {
  const ids = Array.from(new Set(productIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["resale-availability", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, AvailabilityInfo>> => {
      const { data: links, error } = await supabase
        .from("raw_material_products")
        .select(
          "product_id, base_units_per_sold_unit, raw_material:raw_materials!inner(id, name, base_unit, is_resale_item, stock_tracking)",
        )
        .in("product_id", ids);
      if (error) throw error;

      const usable = ((links ?? []) as any[]).filter(
        (l) => l.raw_material?.is_resale_item && l.raw_material?.stock_tracking,
      );
      const rmIds = Array.from(new Set(usable.map((l) => l.raw_material.id)));
      const map = new Map<string, AvailabilityInfo>();
      if (rmIds.length === 0) return map;

      const { data: status } = await supabase
        .from("resale_stock_status")
        .select("raw_material_id, disponibelt")
        .in("raw_material_id", rmIds);
      const availByRm = new Map(
        (status ?? []).map((s) => [s.raw_material_id as string, Number(s.disponibelt) || 0]),
      );

      for (const l of usable) {
        const per = Number(l.base_units_per_sold_unit) || 1;
        const avail = availByRm.get(l.raw_material.id);
        if (avail == null) continue;
        map.set(l.product_id, {
          raw_material_id: l.raw_material.id,
          raw_material_name: l.raw_material.name,
          available_sold_units: avail / per,
          base_unit: l.raw_material.base_unit,
        });
      }
      return map;
    },
  });
}
