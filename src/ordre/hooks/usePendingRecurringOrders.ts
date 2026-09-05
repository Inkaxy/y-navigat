import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { pickEffectiveSchedulesForDate } from "@/ordre/lib/recurringOverrides";
import {
  fetchDeliveryPauses,
  isPausedForDate,
  type DeliveryPauseLike,
} from "@/ordre/lib/pendingOrders";

type DeliveryTourLike = {
  id: string;
  tour_number: number;
  status: string;
  active_monday: boolean;
  active_tuesday: boolean;
  active_wednesday: boolean;
  active_thursday: boolean;
  active_friday: boolean;
  active_saturday: boolean;
  active_sunday: boolean;
};

export type PendingRecurringOrderCounts = {
  total: number;
  byTour: Record<string, number>;
  nullTourCount: number;
};

type RecurringScheduleRow = {
  id: string;
  customer_id: string;
  recurring_order_items?: Array<{ tour_id: string | null; quantity: number | string | null }>;
};

function isoDayOfWeek(isoDate: string): number {
  const d = new Date(`${isoDate}T12:00:00`);
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function activeTourForDate(tour: DeliveryTourLike, isoDow: number) {
  const keys = [
    "active_monday",
    "active_tuesday",
    "active_wednesday",
    "active_thursday",
    "active_friday",
    "active_saturday",
    "active_sunday",
  ] as const;
  return tour.status === "active" && tour[keys[isoDow - 1]];
}

function resolveFallbackTourId(tours: DeliveryTourLike[], isoDow: number) {
  return tours
    .filter((tour) => activeTourForDate(tour, isoDow))
    .slice()
    .sort((a, b) => a.tour_number - b.tour_number)[0]?.id ?? null;
}

export async function fetchPendingRecurringOrderCounts(
  date: string,
  tours: DeliveryTourLike[],
  /** Allerede hentede leveransepauser — spar et rundturs-oppslag. */
  knownPauses?: readonly DeliveryPauseLike[],
): Promise<PendingRecurringOrderCounts> {
  const weekday = isoDayOfWeek(date);
  const fallbackTourId = resolveFallbackTourId(tours, weekday);

  const [{ data: schedules, error: schedulesError }, { data: existingOrders, error: ordersError }, pauses] =
    await Promise.all([
      supabase
        .from("recurring_order_schedules")
        .select("id, customer_id, valid_from, valid_to, recurring_order_items!inner(tour_id, quantity)")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("is_active", true)
        .or(`valid_from.is.null,valid_from.lte.${date}`)
        .or(`valid_to.is.null,valid_to.gte.${date}`)
        .eq("recurring_order_items.weekday", weekday)
        .gt("recurring_order_items.quantity", 0),
      supabase
        .from("orders")
        .select("recurring_schedule_id")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date)
        .not("recurring_schedule_id", "is", null),
      knownPauses ?? fetchDeliveryPauses(date, date),
    ]);

  if (schedulesError) throw schedulesError;
  if (ordersError) throw ordersError;

  const materializedScheduleIds = new Set(
    (existingOrders ?? [])
      .map((row) => row.recurring_schedule_id)
      .filter((id): id is string => Boolean(id)),
  );
  const byTour: Record<string, number> = {};
  let nullTourCount = 0;
  let total = 0;
  const rawSchedules = (schedules ?? []) as RecurringScheduleRow[];
  const effective = pickEffectiveSchedulesForDate(
    rawSchedules as Array<RecurringScheduleRow & { valid_from: string | null; valid_to: string | null }>,
    date,
  );

  for (const schedule of effective) {
    if (materializedScheduleIds.has(schedule.id)) continue;

    const tourIds = new Set(
      (schedule.recurring_order_items ?? [])
        .filter((item) => Number(item.quantity ?? 0) > 0)
        .map((item) => item.tour_id ?? fallbackTourId),
    );
    const resolvedTourId = Array.from(tourIds).filter(Boolean).sort()[0] ?? null;
    // Pause kan gjelde kun enkelte turer (tour_filter).
    if (isPausedForDate(pauses, schedule.customer_id, date, resolvedTourId)) continue;

    if (resolvedTourId) byTour[resolvedTourId] = (byTour[resolvedTourId] ?? 0) + 1;
    else nullTourCount += 1;
    total += 1;
  }

  return { total, byTour, nullTourCount };
}
export type PendingRecurringOrderRow = {
  schedule_id: string;
  customer_id: string;
  customer_display_name: string;
  customer_number: string | null;
  tour_id: string | null;
  tour_label: string | null;
};

export async function fetchPendingRecurringOrderRows(
  date: string,
  tours: DeliveryTourLike[],
  tourFilter: string,
  /** Allerede hentede leveransepauser — spar et rundturs-oppslag. */
  knownPauses?: readonly DeliveryPauseLike[],
): Promise<PendingRecurringOrderRow[]> {
  const weekday = isoDayOfWeek(date);
  const fallbackTourId = resolveFallbackTourId(tours, weekday);

  const [{ data: schedules, error: schedulesError }, { data: existingOrders, error: ordersError }, pauses] =
    await Promise.all([
      supabase
        .from("recurring_order_schedules")
        .select("id, customer_id, valid_from, valid_to, recurring_order_items!inner(tour_id, quantity)")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("is_active", true)
        .or(`valid_from.is.null,valid_from.lte.${date}`)
        .or(`valid_to.is.null,valid_to.gte.${date}`)
        .eq("recurring_order_items.weekday", weekday)
        .gt("recurring_order_items.quantity", 0),
      supabase
        .from("orders")
        .select("recurring_schedule_id")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date)
        .not("recurring_schedule_id", "is", null),
      knownPauses ?? fetchDeliveryPauses(date, date),
    ]);

  if (schedulesError) throw schedulesError;
  if (ordersError) throw ordersError;

  const materialized = new Set(
    (existingOrders ?? []).map((r) => r.recurring_schedule_id).filter((id): id is string => Boolean(id)),
  );
  const tourById = new Map(tours.map((t) => [t.id, t] as const));

  type Row = {
    id: string;
    customer_id: string;
    valid_from: string | null;
    valid_to: string | null;
    recurring_order_items?: Array<{ tour_id: string | null; quantity: number | string | null }>;
  };

  const effectiveRows = pickEffectiveSchedulesForDate((schedules ?? []) as Row[], date);
  const filtered: Array<{ row: Row; resolvedTourId: string | null }> = [];
  for (const s of effectiveRows) {
    if (materialized.has(s.id)) continue;
    const tourIds = new Set(
      (s.recurring_order_items ?? [])
        .filter((it) => Number(it.quantity ?? 0) > 0)
        .map((it) => it.tour_id ?? fallbackTourId),
    );
    const resolvedTourId = Array.from(tourIds).filter(Boolean).sort()[0] ?? null;
    if (isPausedForDate(pauses, s.customer_id, date, resolvedTourId)) continue;

    if (tourFilter === NULL_TOUR_KEY) {
      if (resolvedTourId !== null) continue;
    } else if (tourFilter !== "all") {
      if (resolvedTourId !== tourFilter) continue;
    }
    filtered.push({ row: s, resolvedTourId });
  }

  // Hent kunde-info i én spørring (ingen FK-relasjon å hente via PostgREST).
  const customerIds = Array.from(new Set(filtered.map((f) => f.row.customer_id)));
  const customerById = new Map<string, { display_name: string | null; customer_number: string | null }>();
  if (customerIds.length > 0) {
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id, display_name, customer_number")
      .in("id", customerIds);
    if (custErr) throw custErr;
    for (const c of customers ?? []) {
      customerById.set(c.id as string, { display_name: c.display_name as string | null, customer_number: c.customer_number as string | null });
    }
  }

  const rows: PendingRecurringOrderRow[] = filtered.map(({ row, resolvedTourId }) => {
    const tour = resolvedTourId ? tourById.get(resolvedTourId) : null;
    const cust = customerById.get(row.customer_id);
    return {
      schedule_id: row.id,
      customer_id: row.customer_id,
      customer_display_name: cust?.display_name ?? "—",
      customer_number: cust?.customer_number ?? null,
      tour_id: resolvedTourId,
      tour_label: tour ? `Tur ${(tour as DeliveryTourLike).tour_number}` : null,
    };
  });
  return rows.sort((a, b) => a.customer_display_name.localeCompare(b.customer_display_name, "nb"));
}

export function usePendingRecurringOrderRows(date: string, tourId: string) {
  const toursQ = useDeliveryTours({ activeOnly: true });
  return useQuery({
    queryKey: ["pending-recurring-rows", date, tourId, toursQ.data?.length ?? 0],
    enabled: !toursQ.isLoading,
    queryFn: () => fetchPendingRecurringOrderRows(date, toursQ.data ?? [], tourId),
    staleTime: 15_000,
  });
}
