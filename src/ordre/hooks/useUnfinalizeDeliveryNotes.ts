import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type UnfinalizeResult = {
  updated: number;
  blocked: number;
};

export type UnfinalizeArgs = {
  ids: string[];
  reason?: string | null;
};

export function useUnfinalizeDeliveryNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, reason }: UnfinalizeArgs): Promise<UnfinalizeResult> => {
      const { data, error } = await supabase.rpc("unfinalize_delivery_notes", {
        p_ids: ids,
        p_reason: (reason ?? undefined) as string | undefined,
      });
      if (error) throw error;
      return data as unknown as UnfinalizeResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery-note-counts"] });
      qc.invalidateQueries({ queryKey: ["delivery-notes-list"] });
      qc.invalidateQueries({ queryKey: ["delivery-note-runs"] });
      qc.invalidateQueries({ queryKey: ["delivery-note-detail"] });
    },
  });
}
