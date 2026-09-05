import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { osloTodayISO, osloDateISO } from "@/lib/osloDate";

/**
 * Kunde 360 — read-only oppslag for fanen «Ordre og levering» på kundekortet.
 * Tre spørringer totalt: (1) siste ordrer, (2) fastordre-skjemaer,
 * (3) pauser + pakksedler i samme kall.
 */

export type Customer360Order = {
  id: string;
  order_number: string;
  delivery_date: string;
  status: string;
  source: string;
  total_incl_vat: number;
};

export type Customer360Schedule = {
  id: string;
  name: string;
  is_active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  weekdays: number[];
  tourNames: string[];
  item_count: number;
};

export type Customer360Pause = {
  id: string;
  pause_from: string;
  pause_to: string | null;
  tourNames: string[];
  reason: string | null;
  notes: string | null;
};

export type Customer360Note = {
  id: string;
  display_number: string;
  delivery_date: string;
  status: string;
  total_incl_vat: number;
};

export type Customer360Logistics = {
  pauses: Customer360Pause[];
  notes: Customer360Note[];
};

/** (a) Siste 20 ordrer for kunden. */
export function useCustomer360Orders(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ["customer360", "orders", customerId],
    enabled: !!customerId,
    staleTime: 30_000,
    queryFn: async (): Promise<Customer360Order[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, delivery_date, status, source, total_incl_vat")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("customer_id", customerId!)
        .order("delivery_date", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []).map((o) => ({
        id: o.id,
        order_number: o.order_number,
        delivery_date: o.delivery_date,
        status: o.status,
        source: o.source,
        total_incl_vat: Number(o.total_incl_vat ?? 0),
      }));
    },
  });
}

/** (b) Aktive fastordre-skjemaer med ukedager, turer og antall varelinjer. */
export function useCustomer360Schedules(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ["customer360", "schedules", customerId],
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async (): Promise<Customer360Schedule[]> => {
      const { data, error } = await supabase
        .from("recurring_order_schedules")
        .select(
          "id, name, is_active, valid_from, valid_to, recurring_order_items(id, weekday, tour_id, delivery_tours(display_name))",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("customer_id", customerId!)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(20);
      if (error) throw error;

      type Item = {
        id: string;
        weekday: number | null;
        tour_id: string | null;
        delivery_tours?: { display_name: string | null } | null;
      };

      return (data ?? []).map((row) => {
        const items = (row.recurring_order_items ?? []) as unknown as Item[];
        const weekdays = Array.from(
          new Set(items.map((i) => Number(i.weekday)).filter((w) => w >= 1 && w <= 7)),
        ).sort((a, b) => a - b);
        const tourNames = Array.from(
          new Set(
            items
              .map((i) => i.delivery_tours?.display_name ?? null)
              .filter((n): n is string => !!n),
          ),
        ).sort();
        return {
          id: row.id,
          name: row.name,
          is_active: row.is_active,
          valid_from: row.valid_from,
          valid_to: row.valid_to,
          weekdays,
          tourNames,
          item_count: items.length,
        } satisfies Customer360Schedule;
      });
    },
  });
}

/** (c+d) Leveransepauser og siste 10 pakksedler i én spørring. */
export function useCustomer360Logistics(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ["customer360", "logistics", customerId],
    enabled: !!customerId,
    staleTime: 30_000,
    queryFn: async (): Promise<Customer360Logistics> => {
      const today = osloTodayISO();
      const [pauseRes, notesRes, toursRes] = await Promise.all([
        supabase
          .from("delivery_pauses")
          .select("id, pause_from, pause_to, tour_filter, reason, notes")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("customer_id", customerId!)
          .or(`pause_to.is.null,pause_to.gte.${today}`)
          .order("pause_from", { ascending: true })
          .limit(20),
        supabase
          .from("delivery_notes")
          .select("id, display_number, delivery_date, status, total_incl_vat")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("customer_id", customerId!)
          .order("delivery_date", { ascending: false })
          .limit(10),
        supabase
          .from("delivery_tours")
          .select("id, display_name")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID),
      ]);
      if (pauseRes.error) throw pauseRes.error;
      if (notesRes.error) throw notesRes.error;
      if (toursRes.error) throw toursRes.error;

      const tourName = new Map<string, string>(
        (toursRes.data ?? []).map((t) => [t.id, t.display_name ?? ""]),
      );

      const pauses: Customer360Pause[] = (pauseRes.data ?? []).map((p) => ({
        id: p.id,
        pause_from: p.pause_from,
        pause_to: p.pause_to,
        tourNames: ((p.tour_filter as string[] | null) ?? []).map(
          (id) => tourName.get(id) ?? "Ukjent tur",
        ),
        reason: p.reason,
        notes: p.notes,
      }));

      const notes: Customer360Note[] = (notesRes.data ?? []).map((n) => ({
        id: n.id,
        display_number: n.display_number,
        delivery_date: n.delivery_date as string,
        status: n.status,
        total_incl_vat: Number(n.total_incl_vat ?? 0),
      }));

      return { pauses, notes };
    },
  });
}

/** Neste planlagte leveringsdag utledet av fastordre-ukedager og pauser. */
export function nextPlannedDelivery(
  schedules: Customer360Schedule[] | undefined,
  pauses: Customer360Pause[] | undefined,
): string | null {
  const weekdays = new Set<number>();
  for (const s of schedules ?? []) for (const w of s.weekdays) weekdays.add(w);
  if (weekdays.size === 0) return null;

  const start = new Date(`${osloTodayISO()}T12:00:00`);
  for (let i = 1; i <= 21; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = osloDateISO(d);
    const isoWeekday = ((d.getDay() + 6) % 7) + 1;
    if (!weekdays.has(isoWeekday)) continue;
    const blocked = (pauses ?? []).some(
      (p) =>
        p.tourNames.length === 0 &&
        p.pause_from <= iso &&
        (p.pause_to === null || p.pause_to >= iso),
    );
    if (!blocked) return iso;
  }
  return null;
}
