import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrderLite {
  id: string;
  order_number: string;
  customer_name: string | null;
  delivery_date: string | null;
  status: string;
}

export function useRecentOrdersLite(search: string) {
  return useQuery({
    queryKey: ["orders-lite", search],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select("id, order_number, customer_snapshot, delivery_date, status")
        .order("created_at", { ascending: false })
        .limit(20);
      if (search.trim()) {
        const s = `%${search}%`;
        q = q.or(`order_number.ilike.${s},customer_snapshot->>display_name.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((o) => ({
        id: o.id,
        order_number: o.order_number,
        customer_name:
          (o.customer_snapshot as { display_name?: string } | null)?.display_name ?? null,
        delivery_date: o.delivery_date,
        status: o.status,
      })) as OrderLite[];
    },
  });
}
