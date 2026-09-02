import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import {
  fetchPendingRecurringOrderRows,
  type PendingRecurringOrderRow,
} from "@/ordre/hooks/usePendingRecurringOrders";

export type PendingOrderType = "fast" | "datert" | "retur";
export type PendingOrdersMode = "date" | "correction";

export type PendingOrderRow = {
  kind: "order" | "schedule";
  id: string;
  display_number: string | null;
  customer_id: string;
  customer_display_name: string;
  customer_number: string | null;
  tour_id: string | null;
  tour_label: string | null;
  line_count: number;
  total_incl_vat: number;
  type: PendingOrderType;
  notes: string | null;
  /** Faktisk leveringsdato for ordren (YYYY-MM-DD). Null for schedule-rader. */
  delivery_date: string | null;
};

async function fetchPackedOrderIds(
  date: string,
  tourId: string,
  mode: PendingOrdersMode,
): Promise<Set<string>> {
  let q = supabase
    .from("delivery_notes")
    .select("delivery_note_lines!inner(order_id)")
    .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
    .neq("status", "cancelled");
  q = mode === "correction" ? q.lte("delivery_date", date) : q.eq("delivery_date", date);
  if (tourId === NULL_TOUR_KEY) q = q.is("delivery_tour_id", null);
  else if (tourId !== "all") q = q.eq("delivery_tour_id", tourId);
  const { data, error } = await q;
  if (error) throw error;
  const out = new Set<string>();
  for (const n of (data ?? []) as Array<{ delivery_note_lines: Array<{ order_id: string | null }> }>) {
    for (const l of n.delivery_note_lines ?? []) if (l.order_id) out.add(l.order_id);
  }
  return out;
}

export function usePendingOrdersList(
  date: string,
  tourId: string,
  type: PendingOrderType,
  mode: PendingOrdersMode = "date",
) {
  const toursQ = useDeliveryTours({ activeOnly: true });
  // Fastordre er ikke relevant i korreksjonsmodus — vi tvinger til datert for å unngå feil bruk.
  const effectiveType: PendingOrderType =
    mode === "correction" && type === "fast" ? "datert" : type;

  return useQuery({
    queryKey: ["pending-orders-list", date, tourId, effectiveType, mode, toursQ.data?.length ?? 0],
    enabled: !toursQ.isLoading,
    queryFn: async (): Promise<PendingOrderRow[]> => {
      const tours = toursQ.data ?? [];
      const tourById = new Map(tours.map((t) => [t.id, t] as const));
      const packed = await fetchPackedOrderIds(date, tourId, mode);

      let q = supabase
        .from("orders")
        .select(
          "id, order_number, customer_id, customer_snapshot, delivery_tour_id, delivery_date, total_incl_vat, internal_notes, customer_notes, is_customer_order, is_return, order_lines(id)"
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        // Speiler order_is_production_scope(status) i generate_delivery_notes —
        // awaiting_confirmation venter på godkjenning og skal ikke pakkes.
        .in("status", ["confirmed"]);

      q = mode === "correction" ? q.lte("delivery_date", date) : q.eq("delivery_date", date);

      if (tourId === NULL_TOUR_KEY) q = q.is("delivery_tour_id", null);
      else if (tourId !== "all") q = q.eq("delivery_tour_id", tourId);

      if (effectiveType === "fast") q = q.eq("is_customer_order", false).eq("is_return", false);
      else if (effectiveType === "datert") q = q.eq("is_customer_order", true).eq("is_return", false);
      else q = q.eq("is_return", true);

      const { data, error } = await q.order("delivery_date", { ascending: true }).order("order_number", { ascending: true });
      if (error) throw error;

      const rows: PendingOrderRow[] = ((data ?? []) as any[])
        .filter((o) => !packed.has(o.id))
        .map((o) => {
          const tour = o.delivery_tour_id ? tourById.get(o.delivery_tour_id) : null;
          const snap = (o.customer_snapshot ?? {}) as Record<string, any>;
          return {
            kind: "order" as const,
            id: o.id,
            display_number: o.order_number ?? null,
            customer_id: o.customer_id,
            customer_display_name: snap.display_name ?? snap.name ?? "—",
            customer_number: snap.customer_number ?? snap.number ?? null,
            tour_id: o.delivery_tour_id ?? null,
            tour_label: tour ? `Tur ${tour.tour_number}` : null,
            line_count: Array.isArray(o.order_lines) ? o.order_lines.length : 0,
            total_incl_vat: Number(o.total_incl_vat ?? 0),
            type: effectiveType,
            notes: o.internal_notes ?? o.customer_notes ?? null,
            delivery_date: (o.delivery_date as string) ?? null,
          };
        });


      // For fastordre (kun date-modus): legg til ikke-materialiserte fastordre.
      if (mode === "date" && effectiveType === "fast") {
        const pending: PendingRecurringOrderRow[] = await fetchPendingRecurringOrderRows(
          date,
          tours,
          tourId,
        );
        for (const p of pending) {
          rows.push({
            kind: "schedule",
            id: p.schedule_id,
            display_number: null,
            customer_id: p.customer_id,
            customer_display_name: p.customer_display_name,
            customer_number: p.customer_number,
            tour_id: p.tour_id,
            tour_label: p.tour_label,
            line_count: 0,
            total_incl_vat: 0,
            type: "fast",
            notes: null,
            delivery_date: date,
          });
        }
      }

      return rows.sort((a, b) => {
        // Sorter primært på leveringsdato (stigende), deretter kunde
        const da = a.delivery_date ?? "";
        const db = b.delivery_date ?? "";
        if (da !== db) return da.localeCompare(db);
        return a.customer_display_name.localeCompare(b.customer_display_name, "nb");
      });
    },
    staleTime: 15_000,
  });
}
