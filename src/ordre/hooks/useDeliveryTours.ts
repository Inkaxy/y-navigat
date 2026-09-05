import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { fetchPendingRecurringOrderCounts } from "@/ordre/hooks/usePendingRecurringOrders";
import {
  PRODUCTION_SCOPE_STATUSES,
  fetchDeliveryPauses,
  isPausedForDate,
} from "@/ordre/lib/pendingOrders";

export type DeliveryTour = {
  id: string;
  legal_entity_id: string;
  tour_number: number;
  display_name: string;
  description: string | null;
  time_from: string; // "05:00:00"
  time_to: string;
  active_monday: boolean;
  active_tuesday: boolean;
  active_wednesday: boolean;
  active_thursday: boolean;
  active_friday: boolean;
  active_saturday: boolean;
  active_sunday: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  driver_name: string | null;
  departure_time: string | null; // "07:30:00" | null
  priority: number;
};

/** Sort by priority asc, then display_name (Norwegian collation). */
export function sortToursByPriority<T extends { priority?: number; display_name: string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const pa = a.priority ?? 1;
    const pb = b.priority ?? 1;
    if (pa !== pb) return pa - pb;
    return a.display_name.localeCompare(b.display_name, "nb");
  });
}

const ACTIVE_DAY_KEYS = [
  "active_monday",
  "active_tuesday",
  "active_wednesday",
  "active_thursday",
  "active_friday",
  "active_saturday",
  "active_sunday",
] as const;

export const DAY_LABELS = ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"] as const;

/** Konverter ISO-dato → ISODOW (1=mandag, 7=søndag) */
export function isoDayOfWeek(isoDate: string): number {
  // Bruk UTC-parsing for å unngå tz-skift
  const d = new Date(isoDate + "T12:00:00");
  const js = d.getDay(); // 0=søndag
  return js === 0 ? 7 : js;
}

/** Trim "HH:MM:SS" → "HH:MM" */
export function trimSec(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

/** Sjekk om en tur er aktiv for et gitt isoDate + HH:MM */
export function tourMatches(tour: DeliveryTour, isoDate: string, time: string): boolean {
  if (tour.status !== "active") return false;
  const day = isoDayOfWeek(isoDate);
  const dayActive = tour[ACTIVE_DAY_KEYS[day - 1]];
  if (!dayActive) return false;
  const t = time.length === 5 ? time + ":00" : time;
  return t >= tour.time_from && t < tour.time_to;
}

export function useDeliveryTours(opts?: { activeOnly?: boolean }) {
  return useQuery({
    queryKey: ["delivery-tours", { activeOnly: opts?.activeOnly ?? false }],
    queryFn: async (): Promise<DeliveryTour[]> => {
      let q = supabase
        .from("delivery_tours")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("priority", { ascending: true })
        .order("display_name", { ascending: true });
      if (opts?.activeOnly) q = q.eq("status", "active");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DeliveryTour[];
    },
    staleTime: 60_000,
  });
}

/**
 * Status-whitelist som speiler order_is_production_scope(status) i databasen:
 * kun ordre som vil bli plukket opp av Hovedkjøring teller.
 */
export const TOUR_COUNT_STATUS_WHITELIST = PRODUCTION_SCOPE_STATUSES;


export type TourOrderCounts = {
  /** Antall ordre per delivery_tour_id (kun NOT NULL). */
  byTour: Record<string, number>;
  /** Antall ordre med delivery_tour_id IS NULL. */
  nullTourCount: number;
};

/** Antall ordrer per tur for en gitt dato. Inkluderer "Uten tur"-bøtte. */
export function useTourOrderCounts(isoDate: string) {
  const toursQ = useDeliveryTours({ activeOnly: true });

  return useQuery({
    queryKey: ["tour-order-counts", isoDate, toursQ.data],
    enabled: !toursQ.isLoading,
    queryFn: async (): Promise<TourOrderCounts> => {
      const [{ data, error }, pendingRecurring, pauses] = await Promise.all([
        supabase
          .from("orders")
          .select("customer_id, delivery_tour_id")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("delivery_date", isoDate)
          .eq("is_return", false)
          .in("status", TOUR_COUNT_STATUS_WHITELIST as unknown as string[]),
        fetchPendingRecurringOrderCounts(isoDate, toursQ.data ?? []),
        fetchDeliveryPauses(isoDate, isoDate),
      ]);
      if (error) throw error;
      const byTour: Record<string, number> = { ...pendingRecurring.byTour };
      let nullTourCount = pendingRecurring.nullTourCount;
      for (const r of data ?? []) {
        const row = r as { customer_id: string; delivery_tour_id: string | null };
        if (isPausedForDate(pauses, row.customer_id, isoDate, row.delivery_tour_id)) continue;
        if (row.delivery_tour_id) byTour[row.delivery_tour_id] = (byTour[row.delivery_tour_id] ?? 0) + 1;
        else nullTourCount += 1;
      }
      return { byTour, nullTourCount };
    },
    staleTime: 30_000,
  });
}
