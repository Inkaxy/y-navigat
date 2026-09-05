import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import { fetchPendingRecurringOrderCounts } from "@/ordre/hooks/usePendingRecurringOrders";
import { fetchAllRows } from "@/lib/supabasePaging";
import {
  PRODUCTION_SCOPE_STATUSES,
  correctionFromDate,
  fetchDeliveryPauses,
  fetchPendingReturnNotesCount,
  fetchScopedNotes,
  isPendingOrder,
  type PendingOrderLike,
} from "@/ordre/lib/pendingOrders";

export type DeliveryNoteCounts = {
  fastordre: number;
  datert: number;
  ekstra: number;
  retur: number;
  pakksedler: number;
};

export type DeliveryNoteCountsMode = "date" | "correction";

type OrderRow = PendingOrderLike & { order_kind: string };

/**
 * Teller gjenstående fastordre / daterte / ekstra ordre, ventende returer og
 * aktive pakksedler for valgt (dato, tur).
 * tourId === "all" → ingen tur-filter.
 * mode === "correction" → siste 60 dager t.o.m. valgt dato.
 */
export function useDeliveryNoteCounts(
  date: string,
  tourId: string,
  mode: DeliveryNoteCountsMode = "date",
) {
  const toursQ = useDeliveryTours({ activeOnly: true });

  return useQuery({
    queryKey: ["delivery-note-counts", date, tourId, mode, toursQ.data],
    enabled: !toursQ.isLoading,
    queryFn: async (): Promise<DeliveryNoteCounts> => {
      const isCorrection = mode === "correction";
      const fromDate = isCorrection ? correctionFromDate(date) : date;
      const nullTour = tourId === NULL_TOUR_KEY;
      const scopedTourId = nullTour || tourId === "all" ? null : tourId;

      const [scoped, pauses, returCount] = await Promise.all([
        fetchScopedNotes({ fromDate, toDate: date, tourId: scopedTourId, nullTour }),
        fetchDeliveryPauses(fromDate, date),
        fetchPendingReturnNotesCount(date),
      ]);

      const orders = await fetchAllRows<OrderRow>((from, to) => {
        let q = supabase
          .from("orders")
          .select("id, customer_id, status, is_return, order_kind, delivery_tour_id, delivery_date")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .in("status", PRODUCTION_SCOPE_STATUSES as unknown as string[])
          .gte("delivery_date", fromDate)
          .lte("delivery_date", date)
          .order("id", { ascending: true })
          .range(from, to);
        if (nullTour) q = q.is("delivery_tour_id", null);
        else if (scopedTourId) q = q.eq("delivery_tour_id", scopedTourId);
        return q as unknown as PromiseLike<{ data: OrderRow[] | null; error: { message: string } | null }>;
      });

      const pending = orders.filter((o) => isPendingOrder(o, scoped.packedOrderIds, pauses));

      const pendingRecurring = isCorrection
        ? { total: 0, nullTourCount: 0, byTour: {} as Record<string, number> }
        : await fetchPendingRecurringOrderCounts(date, toursQ.data ?? []);

      const pendingFastordre = isCorrection
        ? 0
        : tourId === "all"
          ? pendingRecurring.total
          : nullTour
            ? pendingRecurring.nullTourCount
            : pendingRecurring.byTour[tourId] ?? 0;

      const countKind = (kind: string) => pending.filter((o) => o.order_kind === kind).length;

      return {
        fastordre: isCorrection ? 0 : countKind("fixed") + pendingFastordre,
        datert: countKind("dated"),
        ekstra: countKind("extra"),
        retur: returCount,
        pakksedler: scoped.noteCount,
      };
    },
    staleTime: 15_000,
  });
}
