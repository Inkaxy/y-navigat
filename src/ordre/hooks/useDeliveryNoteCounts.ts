import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type DeliveryNoteCounts = {
  fastordre: number;
  datert: number;
  retur: number;
  pakksedler: number;
};

/**
 * Teller fastordre / daterte ordre / returordre / pakksedler for valgt (dato, tur).
 * tourId === "all" → ingen tur-filter.
 */
export function useDeliveryNoteCounts(date: string, tourId: string) {
  return useQuery({
    queryKey: ["delivery-note-counts", date, tourId],
    queryFn: async (): Promise<DeliveryNoteCounts> => {
      // Hent ordre-IDer som allerede har en aktiv pakkseddel for valgt dato/tur,
      // slik at "kø"-tellerne (FASTORDRE/DATERTE/RETUR) viser gjenstående arbeid.
      let notesQ = supabase
        .from("delivery_notes")
        .select("id, delivery_note_lines!inner(order_id)")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date)
        .neq("status", "cancelled");
      if (tourId !== "all") notesQ = notesQ.eq("delivery_tour_id", tourId);
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
          .eq("delivery_date", date);
        if (tourId !== "all") q = q.eq("delivery_tour_id", tourId);
        if (packedOrderIds.size > 0) {
          q = q.not(
            "id",
            "in",
            `(${Array.from(packedOrderIds).join(",")})`,
          );
        }
        return q;
      };

      const [fastRes, datertRes, returRes] = await Promise.all([
        buildOrdersBase().eq("is_customer_order", false).eq("is_return", false),
        buildOrdersBase().eq("is_customer_order", true).eq("is_return", false),
        buildOrdersBase().eq("is_return", true),
      ]);

      if (fastRes.error) throw fastRes.error;
      if (datertRes.error) throw datertRes.error;
      if (returRes.error) throw returRes.error;
      if (notesRes.error) throw notesRes.error;

      return {
        fastordre: fastRes.count ?? 0,
        datert: datertRes.count ?? 0,
        retur: returRes.count ?? 0,
        pakksedler: notesRes.count ?? 0,
      };
    },
    staleTime: 15_000,
  });
}
