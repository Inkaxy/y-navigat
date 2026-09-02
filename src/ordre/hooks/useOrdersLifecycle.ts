import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OrderKind, OrderLifecycle } from "@/ordre/lib/orderStatus";

export type OrderLifecycleRow = {
  order_id: string;
  lifecycle: OrderLifecycle;
  order_kind: OrderKind;
  approval_reason: string | null;
  delivery_note_id: string | null;
  delivery_note_number: string | null;
  delivery_note_status: string | null;
  invoice_basis_id: string | null;
  invoice_number: string | null;
};

export type LifecycleMap = Map<string, OrderLifecycleRow>;

/**
 * Batch-oppslag av utledet livssyklus for et sett ordre.
 * Cacher per (sortert) liste med ordre-id-er.
 */
export function useOrdersLifecycle(orderIds: (string | null | undefined)[]) {
  const ids = useMemo(
    () => Array.from(new Set(orderIds.filter((id): id is string => !!id))).sort(),
    [orderIds],
  );

  const query = useQuery({
    queryKey: ["orders-lifecycle", ids],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<OrderLifecycleRow[]> => {
      const { data, error } = await supabase.rpc("orders_lifecycle", { p_order_ids: ids });
      if (error) throw error;
      return (data ?? []) as unknown as OrderLifecycleRow[];
    },
  });

  const map = useMemo(() => {
    const m: LifecycleMap = new Map();
    for (const row of query.data ?? []) m.set(row.order_id, row);
    return m;
  }, [query.data]);

  return { ...query, map };
}
