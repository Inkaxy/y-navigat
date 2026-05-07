import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CompletedMainRun = {
  id: string;
  tour_filter: string[] | null;
  finished_at: string | null;
};

/** Hent alle completed main-kjøringer for (legal_entity, dato). */
export function useCompletedMainRuns(legalEntityId: string, isoDate: string) {
  return useQuery({
    queryKey: ["delivery-note-runs", "completed-main", legalEntityId, isoDate],
    queryFn: async (): Promise<CompletedMainRun[]> => {
      const { data, error } = await supabase
        .from("delivery_note_runs")
        .select("id, tour_filter, finished_at")
        .eq("legal_entity_id", legalEntityId)
        .eq("delivery_date", isoDate)
        .eq("run_type", "main")
        .eq("status", "completed");
      if (error) throw error;
      return (data ?? []) as CompletedMainRun[];
    },
    staleTime: 15_000,
  });
}
