import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { isoDayOfWeek } from "@/ordre/hooks/useDeliveryTours";

export type RecurringGhostMap = Map<string, number>; // key: `${date}|${tourId}|${productId}`

const DAY_KEYS = [
  "active_monday",
  "active_tuesday",
  "active_wednesday",
  "active_thursday",
  "active_friday",
  "active_saturday",
  "active_sunday",
] as const;

/**
 * Fastordre-forhåndsutfylling: henter alle recurring_order_items for kunden
 * (via aktive schedules), og mapper hver item til konkrete datoer i intervallet
 * basert på item.weekday (1=mandag … 7=søndag).
 *
 * Items uten tour_id ekspanderes til ALLE aktive turer for ukedagen, slik at
 * grunnlaget alltid vises i matrisen selv om brukeren ikke har valgt tur i
 * fastordre-malen.
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
      const [schedRes, toursRes] = await Promise.all([
        supabase
          .from("recurring_order_schedules")
          .select(
            "id, valid_from, valid_to, is_active, recurring_order_items(product_id, weekday, tour_id, quantity)",
          )
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("customer_id", customerId!)
          .eq("is_active", true),
        supabase
          .from("delivery_tours")
          .select(
            "id, active_monday, active_tuesday, active_wednesday, active_thursday, active_friday, active_saturday, active_sunday, status",
          )
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("status", "active"),
      ]);
      if (schedRes.error) throw schedRes.error;
      if (toursRes.error) throw toursRes.error;

      // Map weekday (1-7) -> tour ids active that day
      const toursByDow = new Map<number, string[]>();
      for (let dow = 1; dow <= 7; dow++) {
        const key = DAY_KEYS[dow - 1];
        const ids = (toursRes.data ?? [])
          .filter((t: any) => t[key])
          .map((t: any) => t.id as string);
        toursByDow.set(dow, ids);
      }

      const out: RecurringGhostMap = new Map();
      const days = enumerateDates(dateFrom, dateTo);

      for (const sched of (schedRes.data ?? []) as Array<{
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
            if (!item.quantity || Number(item.quantity) <= 0) continue;
            const targetTours = item.tour_id
              ? [item.tour_id]
              : toursByDow.get(dow) ?? [];
            for (const tid of targetTours) {
              const key = `${date}|${tid}|${item.product_id}`;
              out.set(key, (out.get(key) ?? 0) + Number(item.quantity));
            }
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
