import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ColumnCommentMap = Map<string, string>; // key: `${date}|${tour_id}` -> notes

/** Henter orders.internal_notes for kunde i synlig dato-intervall, indeksert på (date|tour_id). */
export function useColumnComments(
  customerId: string | null,
  dateFrom: string,
  dateTo: string,
) {
  return useQuery({
    queryKey: ["matrix-column-comments", customerId, dateFrom, dateTo],
    enabled: !!customerId,
    queryFn: async (): Promise<ColumnCommentMap> => {
      const { data, error } = await supabase
        .from("orders")
        .select("delivery_date, delivery_tour_id, internal_notes")
        .eq("customer_id", customerId!)
        .gte("delivery_date", dateFrom)
        .lte("delivery_date", dateTo)
        .neq("status", "cancelled")
        .not("internal_notes", "is", null);
      if (error) throw error;
      const map: ColumnCommentMap = new Map();
      for (const r of data ?? []) {
        if (!r.delivery_tour_id || !r.internal_notes) continue;
        map.set(`${r.delivery_date}|${r.delivery_tour_id}`, r.internal_notes);
      }
      return map;
    },
    staleTime: 15_000,
  });
}

export function useUpsertColumnComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customerId: string;
      date: string;
      tourId: string;
      comment: string;
    }) => {
      const { data, error } = await supabase.rpc("upsert_matrix_column_comment", {
        p_customer_id: input.customerId,
        p_date: input.date,
        p_tour_id: input.tourId,
        p_comment: input.comment,
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["matrix-column-comments"] });
      qc.invalidateQueries({ queryKey: ["matrix"] });
    },
  });
}

export function useDeleteMatrixColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { customerId: string; date: string; tourId: string }) => {
      const { data, error } = await supabase.rpc("delete_matrix_column", {
        p_customer_id: input.customerId,
        p_date: input.date,
        p_tour_id: input.tourId,
      });
      if (error) throw error;
      const row = (data ?? [])[0] as { lines_deleted: number; order_deleted: boolean } | undefined;
      return row ?? { lines_deleted: 0, order_deleted: false };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["matrix"] });
      qc.invalidateQueries({ queryKey: ["matrix-column-comments"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
