import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type UndoDeliveryRunsResult = {
  notes_deleted: number;
  lines_deleted: number;
  runs_cancelled: number;
  recurring_orders_deleted: number;
  delivery_date: string;
  tour_filter: string[] | null;
};

export type UndoDeliveryRunsArgs = {
  date: string; // YYYY-MM-DD
  tourFilter: string[] | null;
};

export function useUndoDeliveryRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ date, tourFilter }: UndoDeliveryRunsArgs): Promise<UndoDeliveryRunsResult> => {
      const { data, error } = await (supabase.rpc as any)("undo_delivery_runs", {
        p_legal_entity_id: NB_LEGAL_ENTITY_ID,
        p_delivery_date: date,
        p_tour_filter: tourFilter,
      });
      if (error) throw error;
      return data as UndoDeliveryRunsResult;
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
