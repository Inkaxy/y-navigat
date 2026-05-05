import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryTour } from "../types";

export function useDeliveryTours(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["delivery_tours", legalEntityId ?? null],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<DeliveryTour[]> => {
      const { data, error } = await supabase
        .from("delivery_tours")
        .select("id, legal_entity_id, tour_number, display_name, status")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("tour_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DeliveryTour[];
    },
  });
}
