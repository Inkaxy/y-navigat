import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Henter tur-etikett (f.eks. "Tur 1") for et sett av order_lines via
 * orders.delivery_tour_id → delivery_tours.tour_number.
 * Returnerer Record<order_line_id, string | null>.
 */
export function useOrderLineTours(orderLineIds: string[] | undefined) {
  const ids = (orderLineIds ?? []).filter(Boolean).slice().sort();
  return useQuery({
    queryKey: ["order_line_tours", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: () => fetchOrderLineTours(ids),
      const { data: lines, error } = await supabase
        .from("order_lines")
        .select("id, order_id")
        .in("id", ids);
      if (error) throw error;
      const orderIds = Array.from(
        new Set((lines ?? []).map((l) => (l as { order_id: string }).order_id)),
      );
      const out: Record<string, string | null> = {};
      for (const id of ids) out[id] = null;
      if (orderIds.length === 0) return out;

      const { data: orders, error: oErr } = await supabase
        .from("orders")
        .select("id, delivery_tour_id")
        .in("id", orderIds);
      if (oErr) throw oErr;

      const tourIds = Array.from(
        new Set(
          (orders ?? [])
            .map((o) => (o as { delivery_tour_id: string | null }).delivery_tour_id)
            .filter((x): x is string => !!x),
        ),
      );

      let tourMap: Record<string, number> = {};
      if (tourIds.length > 0) {
        const { data: tours, error: tErr } = await supabase
          .from("delivery_tours")
          .select("id, tour_number")
          .in("id", tourIds);
        if (tErr) throw tErr;
        for (const t of tours ?? []) {
          tourMap[(t as { id: string }).id] = (t as { tour_number: number }).tour_number;
        }
      }

      const orderToTour: Record<string, string | null> = {};
      for (const o of orders ?? []) {
        const row = o as { id: string; delivery_tour_id: string | null };
        const num = row.delivery_tour_id ? tourMap[row.delivery_tour_id] : null;
        orderToTour[row.id] = num != null ? `Tur ${num}` : null;
      }

      for (const l of lines ?? []) {
        const row = l as { id: string; order_id: string };
        out[row.id] = orderToTour[row.order_id] ?? null;
      }
      return out;
    },
    staleTime: 30_000,
  });
}
