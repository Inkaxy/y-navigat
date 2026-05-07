import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { isoDayOfWeek } from "@/ordre/hooks/useDeliveryTours";

export type RecurringGhostMap = Map<string, number>; // key: `${date}|${tourId}|${productId}`

/**
 * Fastordre-forhåndsutfylling: henter alle recurring_order_items for kunden
 * (via aktive schedules), og mapper hver item til konkrete datoer i intervallet
 * basert på item.weekday (1=mandag … 7=søndag).
 *
 * Items uten tour_id ignoreres (ghost trenger eksplisitt tur).
 */
export function useRecurringGhost(
  customerId: string | null,
  dateFrom: string,
  dateTo: string,
) {
  return useQuery({
    queryKey: ["recurring-ghost", customerId, dateFrom, dateTo],
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async (): Promise<RecurringGhostMap> => {
      const { data, error } = await supabase
        .from("recurring_order_schedules")
        .select(
          "id, valid_from, valid_to, is_active, recurring_order_items(product_id, weekday, tour_id, quantity)",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("customer_id", customerId!)
        .eq("is_active", true);
      if (error) throw error;

      const out: RecurringGhostMap = new Map();
      const days = enumerateDates(dateFrom, dateTo);

      for (const sched of (data ?? []) as Array<{
        valid_from: string | null;
        valid_to: string | null;
        recurring_order_items: Array<{
          product_id: string;
          weekday: number;
          tour_id: string | null;
          quantity: number;
        }> | null;
      }>) {
        for (const date of days) {
          if (sched.valid_from && date < sched.valid_from) continue;
          if (sched.valid_to && date > sched.valid_to) continue;
          const dow = isoDayOfWeek(date);
          for (const item of sched.recurring_order_items ?? []) {
            if (item.weekday !== dow) continue;
            if (!item.tour_id) continue;
            if (!item.quantity || Number(item.quantity) <= 0) continue;
            const key = `${date}|${item.tour_id}|${item.product_id}`;
            // Hvis flere schedules treffer samme celle: summér (sjelden, men
            // tryggere enn å tape data).
            out.set(key, (out.get(key) ?? 0) + Number(item.quantity));
          }
        }
      }
      return out;
    },
  });
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
