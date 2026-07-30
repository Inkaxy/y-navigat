import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LabelProductRow, LabelScreenFilter } from "../types";

export const labelProductsQueryKey = (filter: LabelScreenFilter) =>
  ["label_products", filter.legalEntityId, filter.date, filter.tourIds] as const;

export function useLabelProducts(filter: LabelScreenFilter | null) {
  return useQuery({
    queryKey: filter
      ? labelProductsQueryKey(filter)
      : ["label_products", "disabled"],
    enabled: !!filter && !!filter.legalEntityId && !!filter.date,
    queryFn: async (): Promise<LabelProductRow[]> => {
      if (!filter) return [];
      const { data, error } = await supabase.rpc("get_label_products_for_date", {
        p_date: filter.date,
        p_legal_entity_id: filter.legalEntityId,
        p_tour_ids: filter.tourIds ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as unknown as LabelProductRow[];
    },
  });
}
