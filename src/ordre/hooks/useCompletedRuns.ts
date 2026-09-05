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
        .select("id, tour_filter, finished_at, completed_at")
        .eq("legal_entity_id", legalEntityId)
        .eq("delivery_date", isoDate)
        .eq("run_type", "main")
        .eq("status", "completed");
      if (error) throw error;
      return ((data ?? []) as Array<{
        id: string;
        tour_filter: string[] | null;
        finished_at: string | null;
        completed_at: string | null;
      }>).map((r) => ({
        id: r.id,
        tour_filter: r.tour_filter,
        // generate_delivery_notes skriver completed_at; finished_at er eldre kolonne.
        finished_at: r.completed_at ?? r.finished_at,
      }));
    },
    staleTime: 15_000,
  });
}
