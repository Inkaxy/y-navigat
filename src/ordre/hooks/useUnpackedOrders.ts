import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";

/**
 * Ordre-kø som ennå ikke er dekket av en aktiv pakkseddel for valgt dato.
 * Brukes til Fastordre / Daterte ordre / Returordre-listene.
 */
export type UnpackedOrderKind = "fast" | "datert" | "retur";

export type UnpackedOrderRow = {
  order_id: string;
  display_number: string | null;
  customer_id: string;
  customer_display_name: string;
  customer_number: string | null;
  delivery_tour_id: string | null;
  tour_label: string | null;
  line_count: number;
  total_incl_vat: number;
  is_recurring: boolean;
};

type OrderQueryRow = {
  id: string;
  order_number: string | null;
  customer_id: string;
  delivery_tour_id: string | null;
  total_incl_vat: number | string | null;
  recurring_schedule_id: string | null;
  order_lines: Array<{ id: string }> | null;
};

export async function fetchUnpackedOrders(
  date: string,
  tourId: string,
  kind: UnpackedOrderKind,
  tours: Array<{ id: string; tour_number: number; display_name: string }>,
): Promise<UnpackedOrderRow[]> {
  // 1) Hent ordre-IDer som allerede er dekket av aktiv pakkseddel for datoen.
  let notesQ = supabase
    .from("delivery_notes")
    .select("id, delivery_note_lines!inner(order_id)")
    .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
    .eq("delivery_date", date)
    .neq("status", "cancelled");
  if (tourId === NULL_TOUR_KEY) notesQ = notesQ.is("delivery_tour_id", null);
  else if (tourId !== "all") notesQ = notesQ.eq("delivery_tour_id", tourId);
  const { data: notes, error: notesErr } = await notesQ;
  if (notesErr) throw notesErr;

  const packedOrderIds = new Set<string>();
  for (const n of (notes ?? []) as Array<{ delivery_note_lines: Array<{ order_id: string | null }> }>) {
    for (const l of n.delivery_note_lines ?? []) {
      if (l.order_id) packedOrderIds.add(l.order_id);
    }
  }

  // 2) Hent ordre for valgt kind/dato/tur.
  let ordersQ = supabase
    .from("orders")
    .select(
      "id, order_number, customer_id, delivery_tour_id, total_incl_vat, recurring_schedule_id, order_lines(id)",
    )
    .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
    .eq("delivery_date", date);

  if (tourId === NULL_TOUR_KEY) ordersQ = ordersQ.is("delivery_tour_id", null);
  else if (tourId !== "all") ordersQ = ordersQ.eq("delivery_tour_id", tourId);

  if (kind === "fast") ordersQ = ordersQ.eq("is_customer_order", false).eq("is_return", false);
  else if (kind === "datert") ordersQ = ordersQ.eq("is_customer_order", true).eq("is_return", false);
  else if (kind === "retur") ordersQ = ordersQ.eq("is_return", true);

  const { data: orders, error: ordersErr } = await ordersQ;
  if (ordersErr) throw ordersErr;

  const filtered = ((orders ?? []) as OrderQueryRow[]).filter((o) => !packedOrderIds.has(o.id));
  if (filtered.length === 0) return [];

  // 3) Hent kunde-info.
  const customerIds = Array.from(new Set(filtered.map((o) => o.customer_id)));
  const { data: customers, error: custErr } = await supabase
    .from("customers")
    .select("id, display_name, customer_number")
    .in("id", customerIds);
  if (custErr) throw custErr;
  const customerById = new Map<string, { display_name: string | null; customer_number: string | null }>();
  for (const c of customers ?? []) {
    customerById.set(c.id as string, {
      display_name: (c.display_name as string | null) ?? null,
      customer_number: (c.customer_number as string | null) ?? null,
    });
  }

  const tourById = new Map(tours.map((t) => [t.id, t] as const));

  return filtered
    .map<UnpackedOrderRow>((o) => {
      const cust = customerById.get(o.customer_id);
      const tour = o.delivery_tour_id ? tourById.get(o.delivery_tour_id) : null;
      return {
        order_id: o.id,
        display_number: o.order_number ?? null,
        customer_id: o.customer_id,
        customer_display_name: cust?.display_name ?? "—",
        customer_number: cust?.customer_number ?? null,
        delivery_tour_id: o.delivery_tour_id,
        tour_label: tour ? `Tur ${tour.tour_number}` : null,
        line_count: Array.isArray(o.order_lines) ? o.order_lines.length : 0,
        total_incl_vat: Number(o.total_incl_vat ?? 0),
        is_recurring: Boolean(o.recurring_schedule_id),
      };
    })
    .sort((a, b) => a.customer_display_name.localeCompare(b.customer_display_name, "nb"));
}

export function useUnpackedOrders(date: string, tourId: string, kind: UnpackedOrderKind) {
  const toursQ = useDeliveryTours({ activeOnly: true });
  return useQuery({
    queryKey: ["unpacked-orders", kind, date, tourId, toursQ.data?.length ?? 0],
    enabled: !toursQ.isLoading,
    queryFn: () => fetchUnpackedOrders(date, tourId, kind, toursQ.data ?? []),
    staleTime: 10_000,
  });
}
