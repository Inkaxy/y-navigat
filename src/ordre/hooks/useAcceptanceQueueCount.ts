import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

/**
 * Antall bestillinger som venter på bekreftelse (aksept-kø).
 * Brukes som badge på "Aksept-kø"-pill i OrdersList.
 */
export function useAcceptanceQueueCount() {
  return useQuery({
    queryKey: ["orders", "acceptance-queue-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "awaiting_confirmation");
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}
