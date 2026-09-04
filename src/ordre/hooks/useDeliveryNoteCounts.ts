import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import { fetchPendingRecurringOrderCounts } from "@/ordre/hooks/usePendingRecurringOrders";

export type DeliveryNoteCounts = {
  fastordre: number;
  datert: number;
  ekstra: number;
  retur: number;
  pakksedler: number;
};

export type DeliveryNoteCountsMode = "date" | "correction";

/**
 * Teller fastordre / daterte ordre / returordre / pakksedler for valgt (dato, tur).
 * tourId === "all" → ingen tur-filter.
 * mode === "correction" → inkluder alt t.o.m. valgt dato (lte) for datert/retur og pakksedler.
 *                          Fastordre er ikke relevant i korreksjonsmodus.
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

      // Hent ordre-IDer som allerede har en aktiv pakkseddel for valgt scope,
      // slik at "kø"-tellerne (FASTORDRE/DATERTE/RETUR) viser gjenstående arbeid.
      let notesQ = supabase
        .from("delivery_notes")
        .select("id, delivery_note_lines!inner(order_id)")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .neq("status", "cancelled");
      notesQ = isCorrection
        ? notesQ.lte("delivery_date", date)
        : notesQ.eq("delivery_date", date);
      if (tourId === NULL_TOUR_KEY) notesQ = notesQ.is("delivery_tour_id", null);
      else if (tourId !== "all") notesQ = notesQ.eq("delivery_tour_id", tourId);
      const { data: notesWithLines, error: notesLinesErr } = await notesQ;
      if (notesLinesErr) throw notesLinesErr;

      const packedOrderIds = new Set<string>();
      for (const n of (notesWithLines ?? []) as Array<{
        delivery_note_lines: Array<{ order_id: string | null }>;
      }>) {
        for (const l of n.delivery_note_lines ?? []) {
          if (l.order_id) packedOrderIds.add(l.order_id);
        }
      }
      const pakksedlerCount = (notesWithLines ?? []).length;

      const buildOrdersBase = () => {
        let q = supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          // Speiler order_is_production_scope(status) i generate_delivery_notes.
          .in("status", ["confirmed"]);
        q = isCorrection ? q.lte("delivery_date", date) : q.eq("delivery_date", date);
        if (tourId === NULL_TOUR_KEY) q = q.is("delivery_tour_id", null);
        else if (tourId !== "all") q = q.eq("delivery_tour_id", tourId);
        if (packedOrderIds.size > 0) {
          q = q.not(
            "id",
            "in",
            `(${Array.from(packedOrderIds).join(",")})`,
          );
        }
        return q;
      };

      const [fastRes, datertRes, ekstraRes, returRes, pendingRecurring] = await Promise.all([
        isCorrection
          ? Promise.resolve({ count: 0, error: null as null })
          : buildOrdersBase().eq("order_kind", "fixed"),
        buildOrdersBase().eq("order_kind", "dated").eq("is_return", false),
        buildOrdersBase().eq("order_kind", "extra"),
        buildOrdersBase().eq("order_kind", "return"),
        isCorrection
          ? Promise.resolve({ total: 0, nullTourCount: 0, byTour: {} as Record<string, number> })
          : fetchPendingRecurringOrderCounts(date, toursQ.data ?? []),
      ]);

      if ((fastRes as any).error) throw (fastRes as any).error;
      if (datertRes.error) throw datertRes.error;
      if (ekstraRes.error) throw ekstraRes.error;
      if (returRes.error) throw returRes.error;

      const pendingFastordre = isCorrection
        ? 0
        : tourId === "all"
          ? pendingRecurring.total
          : tourId === NULL_TOUR_KEY
            ? pendingRecurring.nullTourCount
            : pendingRecurring.byTour[tourId] ?? 0;

      return {
        fastordre: ((fastRes as any).count ?? 0) + pendingFastordre,
        datert: datertRes.count ?? 0,
        ekstra: ekstraRes.count ?? 0,
        retur: returRes.count ?? 0,
        pakksedler: pakksedlerCount,
      };
    },
    staleTime: 15_000,
  });
}
