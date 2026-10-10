import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseRematchStatus, type RematchStatus } from "@/fakturaer/lib/parseRpcJson";

/** Køstatus for omberegning. Hyppig oppdatering mens køen arbeider, ellers hvert minutt. */
export function useRematchStatus(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["rematch-status", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<RematchStatus> => {
      const { data, error } = await supabase.rpc("rm_rematch_status", { p_legal_entity_id: legalEntityId! });
      if (error) throw error;
      return parseRematchStatus(data);
    },
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && d.queued + d.in_flight > 0 ? 10_000 : 60_000;
    },
  });
}
