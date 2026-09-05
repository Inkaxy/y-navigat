import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import { fetchAllRows } from "@/lib/supabasePaging";
import {
  fetchPendingRecurringOrderRows,
  type PendingRecurringOrderRow,
} from "@/ordre/hooks/usePendingRecurringOrders";
import {
  PRODUCTION_SCOPE_STATUSES,
  correctionFromDate,
  fetchDeliveryPauses,
  fetchScopedNotes,
  isPendingOrder,
} from "@/ordre/lib/pendingOrders";

export type PendingOrderType = "fast" | "datert" | "ekstra" | "retur";
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

const ORDER_KIND_BY_TYPE: Record<PendingOrderType, string> = {
  fast: "fixed",
  datert: "dated",
  ekstra: "extra",
  retur: "return",
};

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
      const fromDate = mode === "correction" ? correctionFromDate(date) : date;
      const nullTour = tourId === NULL_TOUR_KEY;
      const scopedTourId = nullTour || tourId === "all" ? null : tourId;

      const [scoped, pauses] = await Promise.all([
        fetchScopedNotes({ fromDate, toDate: date, tourId: scopedTourId, nullTour }),
        fetchDeliveryPauses(fromDate, date),
      ]);

      type Row = {
        id: string;
        order_number: string | null;
        customer_id: string;
        customer_snapshot: Record<string, unknown> | null;
        delivery_tour_id: string | null;
        delivery_date: string;
        status: string;
        is_return: boolean | null;
        total_incl_vat: number | null;
        internal_notes: string | null;
        customer_notes: string | null;
        order_lines: Array<{ id: string }> | null;
      };

      const data = await fetchAllRows<Row>((from, to) => {
        let q = supabase
          .from("orders")
          .select(
            "id, order_number, customer_id, customer_snapshot, delivery_tour_id, delivery_date, status, total_incl_vat, internal_notes, customer_notes, is_return, order_lines(id)",
          )
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .in("status", PRODUCTION_SCOPE_STATUSES as unknown as string[])
          .eq("order_kind", ORDER_KIND_BY_TYPE[effectiveType])
          .gte("delivery_date", fromDate)
          .lte("delivery_date", date)
          .order("delivery_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (nullTour) q = q.is("delivery_tour_id", null);
        else if (scopedTourId) q = q.eq("delivery_tour_id", scopedTourId);
        return q as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
      });

      const rows: PendingOrderRow[] = data
        .filter((o) =>
          // Returordre er per definisjon is_return = true; for RETUR-lista
          // gjelder samme regler, men uten is_return-filteret.
          isPendingOrder(
            effectiveType === "retur" ? { ...o, is_return: false } : o,
            scoped.packedOrderIds,
            pauses,
          ),
        )
        .map((o) => {
          const tour = o.delivery_tour_id ? tourById.get(o.delivery_tour_id) : null;
          const snap = (o.customer_snapshot ?? {}) as Record<string, string | undefined>;
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
            delivery_date: o.delivery_date ?? null,
          };
        });

      // For fastordre (kun date-modus): legg til ikke-materialiserte fastordre.
      if (mode === "date" && effectiveType === "fast") {
        const pending: PendingRecurringOrderRow[] = await fetchPendingRecurringOrderRows(
          date,
          tours,
          tourId,
          pauses,
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
        const da = a.delivery_date ?? "";
        const db = b.delivery_date ?? "";
        if (da !== db) return da.localeCompare(db);
        return a.customer_display_name.localeCompare(b.customer_display_name, "nb");
      });
    },
    staleTime: 15_000,
  });
}
