import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DuplicateOrder = {
  id: string;
  order_number: string;
  status: string;
  total_incl_vat: number;
};

export function useDuplicateOrderCheck(
  customerId: string | null,
  deliveryDate: string | null,
  excludeOrderId?: string | null,
) {
  return useQuery({
    queryKey: ["duplicate-order-check", customerId, deliveryDate, excludeOrderId ?? null],
    enabled: !!customerId && !!deliveryDate,
    queryFn: async (): Promise<DuplicateOrder[]> => {
      if (!customerId || !deliveryDate) return [];
      let q = supabase
        .from("orders")
        .select("id, order_number, status, total_incl_vat")
        .eq("customer_id", customerId)
        .eq("delivery_date", deliveryDate)
        .neq("status", "cancelled");
      if (excludeOrderId) q = q.neq("id", excludeOrderId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((o) => ({
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        total_incl_vat: Number(o.total_incl_vat),
      }));
    },
  });
}
