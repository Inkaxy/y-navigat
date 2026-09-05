import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type DeliveryRunType = "main" | "additional" | "correction";

export type GenerateDeliveryNotesResult = {
  run_id: string;
  run_type: DeliveryRunType;
  tour_filter: string[] | null;
  delivery_date: string;
  notes_generated: number;
  lines_generated: number;
  orders_processed: number;
  orders_skipped: number;
  /** Kun for run_type='correction' — antall annullerte forrige pakksedler. */
  notes_cancelled?: number;
  /** Kun for run_type='main' — antall ordre opprettet fra fastordre. */
  recurring_orders_created?: number;
};

export type GenerateDeliveryNotesArgs = {
  date: string; // YYYY-MM-DD
  tourFilter: string[] | null; // null = alle turer
  runType?: DeliveryRunType; // default "main"
};

export function useGenerateDeliveryNotes() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ date, tourFilter, runType = "main" }: GenerateDeliveryNotesArgs): Promise<GenerateDeliveryNotesResult> => {
      const { data, error } = await supabase.rpc("generate_delivery_notes", {
        p_legal_entity_id: NB_LEGAL_ENTITY_ID,
        p_delivery_date: date,
        p_tour_filter: tourFilter as string[] | undefined,
        p_run_type: runType,
      });
      if (error) throw error;
      return data as unknown as GenerateDeliveryNotesResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery-note-counts"] });
      qc.invalidateQueries({ queryKey: ["delivery-notes-list"] });
      qc.invalidateQueries({ queryKey: ["delivery-note-runs"] });
      qc.invalidateQueries({ queryKey: ["tour-order-counts"] });
      qc.invalidateQueries({ queryKey: ["active-pauses"] });
      qc.invalidateQueries({ queryKey: ["delivery-day-status"] });
      qc.invalidateQueries({ queryKey: ["pending-recurring-rows"] });
      qc.invalidateQueries({ queryKey: ["pending-orders-list"] });
      qc.invalidateQueries({ queryKey: ["return-delivery-notes"] });
    },
  });
}
