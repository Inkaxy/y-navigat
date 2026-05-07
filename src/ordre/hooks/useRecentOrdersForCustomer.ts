import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RecentOrderSummary = {
  id: string;
  order_number: string;
  delivery_date: string;
  status: string;
  total_incl_vat: number;
  line_count: number;
};

export function useRecentOrdersForCustomer(customerId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["recent-orders-for-customer", customerId],
    enabled: !!customerId && enabled,
    queryFn: async (): Promise<RecentOrderSummary[]> => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, delivery_date, status, total_incl_vat, order_lines(count)")
        .eq("customer_id", customerId)
        .neq("status", "cancelled")
        .order("ordered_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []).map((o) => ({
        id: o.id,
        order_number: o.order_number,
        delivery_date: o.delivery_date,
        status: o.status,
        total_incl_vat: Number(o.total_incl_vat),
        line_count: Array.isArray(o.order_lines) ? (o.order_lines[0] as { count: number } | undefined)?.count ?? 0 : 0,
      }));
    },
  });
}

export type CopyableOrderLine = {
  product_id: string;
  quantity: number;
  unit_price: number;
  unit_price_source: string | null;
  unit_price_source_id: string | null;
  discount_percent: number;
  vat_rate: number;
  notes: string | null;
  product_snapshot: Record<string, unknown> | null;
};

export async function fetchOrderLinesForCopy(orderId: string): Promise<CopyableOrderLine[]> {
  const { data, error } = await supabase
    .from("order_lines")
    .select(
      "product_id, quantity, unit_price, unit_price_source, unit_price_source_id, discount_percent, vat_rate, notes, product_snapshot",
    )
    .eq("order_id", orderId)
    .order("line_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((l) => ({
    product_id: l.product_id,
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price),
    unit_price_source: l.unit_price_source,
    unit_price_source_id: l.unit_price_source_id,
    discount_percent: Number(l.discount_percent),
    vat_rate: Number(l.vat_rate),
    notes: l.notes,
    product_snapshot: l.product_snapshot as Record<string, unknown> | null,
  }));
}
