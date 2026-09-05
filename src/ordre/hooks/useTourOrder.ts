import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OrderConflictError } from "@/ordre/lib/orderConflict";

export type TourOrderLine = {
  id: string;
  order_id: string;
  line_number: number;
  product_id: string;
  quantity: number;
  sales_unit: string | null;
  unit_price: number;
  unit_price_source: string | null;
  discount_percent: number | null;
  line_subtotal_excl_vat: number | null;
  line_total_incl_vat: number | null;
  vat_rate: number | null;
  notes: string | null;
  merknad: unknown | null;
  product_snapshot: Record<string, unknown> | null;
};

export type TourOrder = {
  id: string;
  order_number: string;
  status: string;
  is_paid: boolean;
  delivery_date: string;
  delivery_tour_id: string | null;
  customer_id: string;
  subtotal_excl_vat: number | null;
  total_incl_vat: number | null;
  total_vat: number | null;
  /** Versjonsstempel brukt til optimistisk lås ved lagring. */
  updated_at: string;
  lines: TourOrderLine[];
};

export { OrderConflictError };

/**
 * Optimistisk lås: bumper ordrens `updated_at` kun hvis raden fremdeles står
 * på versjonen som ble lastet inn. Treffer 0 rader ved konflikt.
 */
export async function claimOrderRevision(
  orderId: string,
  expectedUpdatedAt: string | null | undefined,
): Promise<string> {
  if (!expectedUpdatedAt) throw new OrderConflictError();
  const next = new Date().toISOString();
  const { data, error } = await supabase
    .from("orders")
    .update({ updated_at: next } as never)
    .eq("id", orderId)
    .eq("updated_at", expectedUpdatedAt)
    .select("id, updated_at");
  if (error) throw error;
  const rows = (data ?? []) as Array<{ updated_at: string }>;
  if (rows.length === 0) throw new OrderConflictError();
  return rows[0].updated_at;
}

type Args = { customerId: string | null; date: string | null; tourId: string | null };

export function useTourOrder({ customerId, date, tourId }: Args) {
  const qc = useQueryClient();
  const enabled = !!customerId && !!date && !!tourId;
  const queryKey = ["tour-order", customerId, date, tourId] as const;

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<TourOrder | null> => {
      const { data: orders, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, is_paid, delivery_date, delivery_tour_id, customer_id, subtotal_excl_vat, total_incl_vat, total_vat, updated_at",
        )
        .eq("customer_id", customerId!)
        .eq("delivery_date", date!)
        .eq("delivery_tour_id", tourId!)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const order = orders?.[0];
      if (!order) return null;
      const { data: lines, error: le } = await supabase
        .from("order_lines")
        .select(
          "id, order_id, line_number, product_id, quantity, sales_unit, unit_price, unit_price_source, discount_percent, line_subtotal_excl_vat, line_total_incl_vat, vat_rate, notes, merknad, product_snapshot",
        )
        .eq("order_id", order.id)
        .order("line_number", { ascending: true });
      if (le) throw le;
      return { ...(order as any), lines: (lines ?? []) as TourOrderLine[] };
    },
  });

  const loadedOrderId = query.data?.id ?? null;

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`tour-order-${customerId}-${date}-${tourId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `customer_id=eq.${customerId}` },
        () => qc.invalidateQueries({ queryKey }),
      );
    // Linjer abonneres kun for den faktiske ordren — uten filter fikk vi
    // invalidering på hver eneste ordrelinje i hele databasen.
    if (loadedOrderId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_lines",
          filter: `order_id=eq.${loadedOrderId}`,
        },
        () => qc.invalidateQueries({ queryKey }),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, date, tourId, enabled, loadedOrderId]);

  return query;
}

export function useUpdateOrderLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<
        Pick<TourOrderLine, "quantity" | "unit_price" | "discount_percent" | "notes">
      > & { unit_price_source?: string };
    }) => {
      const { error } = await supabase.from("order_lines").update(input.patch as any).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tour-order"] });
      qc.invalidateQueries({ queryKey: ["matrix"] });
    },
  });
}

export function useDeleteOrderLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("order_lines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tour-order"] });
      qc.invalidateQueries({ queryKey: ["matrix"] });
    },
  });
}
