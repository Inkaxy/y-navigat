import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { fetchAllRows } from "@/lib/supabasePaging";
import { osloDateISO } from "@/lib/osloDate";
import { osloDateISO } from "@/lib/osloDate";

/**
 * ÉN felles definisjon av hvilke ordre som er «gjenstående» (ventende) for
 * pakkseddelkjøring. Speiler `order_is_production_scope(status)` og resten av
 * reglene i RPC-en `generate_delivery_notes`:
 *   - status i produksjonsscope
 *   - is_return = false
 *   - ingen aktiv leveransepause (med respekt for tour_filter)
 *   - ingen aktiv pakkseddellinje for ordren
 */
export const PRODUCTION_SCOPE_STATUSES = [
  "confirmed",
  "in_production",
  "packed",
] as const;

export type ProductionScopeStatus = (typeof PRODUCTION_SCOPE_STATUSES)[number];

export function isProductionScopeStatus(status: string | null | undefined): boolean {
  return !!status && (PRODUCTION_SCOPE_STATUSES as readonly string[]).includes(status);
}

export type DeliveryPauseLike = {
  customer_id: string;
  pause_from: string;
  pause_to: string | null;
  /** Null/tom = pause gjelder alle turer. Ellers kun de listede turene. */
  tour_filter: string[] | null;
};

/** Er kunden i leveransepause på gitt dato for gitt tur? */
export function isPausedForDate(
  pauses: readonly DeliveryPauseLike[],
  customerId: string,
  date: string,
  tourId: string | null,
): boolean {
  for (const p of pauses) {
    if (p.customer_id !== customerId) continue;
    if (p.pause_from > date) continue;
    if (p.pause_to && p.pause_to < date) continue;
    const filter = p.tour_filter;
    if (filter && filter.length > 0) {
      if (!tourId || !filter.includes(tourId)) continue;
    }
    return true;
  }
  return false;
}

export type PendingOrderLike = {
  id: string;
  customer_id: string;
  status: string;
  is_return?: boolean | null;
  delivery_tour_id: string | null;
  delivery_date: string;
};

/** Speiler regelen i generate_delivery_notes for én ordre. */
export function isPendingOrder(
  order: PendingOrderLike,
  packedOrderIds: ReadonlySet<string>,
  pauses: readonly DeliveryPauseLike[],
): boolean {
  if (!isProductionScopeStatus(order.status)) return false;
  if (order.is_return) return false;
  if (packedOrderIds.has(order.id)) return false;
  if (isPausedForDate(pauses, order.customer_id, order.delivery_date, order.delivery_tour_id)) {
    return false;
  }
  return true;
}

/** Antall dager bakover korreksjonsmodus ser. */
export const CORRECTION_WINDOW_DAYS = 60;

/** ISO-dato forskjøvet et antall dager (Oslo-trygt). */
export function shiftIso(date: string, days: number): string {
  return osloDateISO(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000);
}

/** Nedre grense for korreksjonsmodus (siste 60 dager). */
export function correctionFromDate(date: string): string {
  return shiftIso(date, -CORRECTION_WINDOW_DAYS);
}

/** Hent leveransepauser som er aktive et sted i [fromDate, toDate]. */
export async function fetchDeliveryPauses(
  fromDate: string,
  toDate: string,
  legalEntityId: string = NB_LEGAL_ENTITY_ID,
): Promise<DeliveryPauseLike[]> {
  const { data, error } = await supabase
    .from("delivery_pauses")
    .select("customer_id, pause_from, pause_to, tour_filter")
    .eq("legal_entity_id", legalEntityId)
    .lte("pause_from", toDate)
    .or(`pause_to.is.null,pause_to.gte.${fromDate}`);
  if (error) throw error;
  return (data ?? []) as DeliveryPauseLike[];
}

export type NoteScope = {
  fromDate: string;
  toDate: string;
  /** "all" | NULL_TOUR_KEY-håndteres av kalleren via nullTour */
  tourId?: string | null;
  nullTour?: boolean;
};

export type ScopedNotesResult = {
  /** Ordre-IDer som allerede har en aktiv pakkseddellinje i scope. */
  packedOrderIds: Set<string>;
  /** Antall aktive pakksedler i scope (returnotes ekskludert). */
  noteCount: number;
};

/**
 * Henter aktive pakksedler i scope med paginering og utleder «pakket»-settet
 * klientside — slik at vi slipper `.not("id","in", …)` med hundrevis av UUID-er
 * i URL-en.
 */
export async function fetchScopedNotes(
  scope: NoteScope,
  legalEntityId: string = NB_LEGAL_ENTITY_ID,
): Promise<ScopedNotesResult> {
  const rows = await fetchAllRows<{
    id: string;
    is_return: boolean | null;
    delivery_note_lines: Array<{ order_id: string | null }> | null;
  }>((from, to) => {
    let q = supabase
      .from("delivery_notes")
      .select("id, is_return, delivery_note_lines(order_id)")
      .eq("legal_entity_id", legalEntityId)
      .neq("status", "cancelled")
      .gte("delivery_date", scope.fromDate)
      .lte("delivery_date", scope.toDate)
      .order("id", { ascending: true })
      .range(from, to);
    if (scope.nullTour) q = q.is("delivery_tour_id", null);
    else if (scope.tourId) q = q.eq("delivery_tour_id", scope.tourId);
    return q as unknown as PromiseLike<{
      data: Array<{
        id: string;
        is_return: boolean | null;
        delivery_note_lines: Array<{ order_id: string | null }> | null;
      }> | null;
      error: { message: string } | null;
    }>;
  });

  const packedOrderIds = new Set<string>();
  let noteCount = 0;
  for (const n of rows) {
    if (!n.is_return) noteCount += 1;
    for (const l of n.delivery_note_lines ?? []) {
      if (l.order_id) packedOrderIds.add(l.order_id);
    }
  }
  return { packedOrderIds, noteCount };
}

/**
 * Én kilde for «returer som venter på godkjenning» — brukes både av
 * RETUR-flisen og RETUR-lista.
 */
export async function fetchPendingReturnNotesCount(
  maxDate?: string,
  legalEntityId: string = NB_LEGAL_ENTITY_ID,
): Promise<number> {
  let q = supabase
    .from("delivery_notes")
    .select("id", { count: "exact", head: true })
    .eq("legal_entity_id", legalEntityId)
    .eq("is_return", true)
    .eq("status", "draft")
    .is("approved_at", null)
    .is("rejected_at", null);
  if (maxDate) q = q.lte("delivery_date", maxDate);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
