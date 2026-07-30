import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { osloDateISO } from "@/lib/osloDate";

export type PauseInfo = {
  reason: string | null;
  notes: string | null;
};

export type PauseMap = Map<string, PauseInfo>; // key: `${date}|${tourId}`  ('*' for alle turer)

/**
 * Henter delivery_pauses som overlapper [dateFrom, dateTo] for kunden,
 * og bygger et lookup pr (date, tourId).
 *
 * tour_filter NULL eller tom array = pause gjelder ALLE turer den dagen.
 * Ellers gjelder den kun de turene som er nevnt.
 */
export function useDeliveryPausesForCustomer(
  customerId: string | null,
  dateFrom: string,
  dateTo: string,
) {
  return useQuery({
    queryKey: ["delivery-pauses", "customer", customerId, dateFrom, dateTo],
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async (): Promise<PauseMap> => {
      const { data, error } = await supabase
        .from("delivery_pauses")
        .select("pause_from, pause_to, tour_filter, reason, notes")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("customer_id", customerId!)
        .lte("pause_from", dateTo)
        // pause_to = NULL betyr «åpen pause» (ingen sluttdato) og skal alltid med.
        .or(`pause_to.is.null,pause_to.gte.${dateFrom}`);
      if (error) throw error;

      const out: PauseMap = new Map();
      for (const p of (data ?? []) as Array<{
        pause_from: string;
        pause_to: string | null;
        tour_filter: string[] | null;
        reason: string | null;
        notes: string | null;
      }>) {
        const days = enumerateDates(
          p.pause_from < dateFrom ? dateFrom : p.pause_from,
          p.pause_to === null || p.pause_to > dateTo ? dateTo : p.pause_to,
        );
        const tourKeys: string[] =
          p.tour_filter && p.tour_filter.length > 0 ? p.tour_filter : ["*"];
        for (const d of days) {
          for (const t of tourKeys) {
            const k = `${d}|${t}`;
            if (!out.has(k)) out.set(k, { reason: p.reason, notes: p.notes });
          }
        }
      }
      return out;
    },
  });
}

/** Sjekk om en gitt (date, tourId) er pauset. Tar hensyn til wildcard '*'. */
export function isPaused(map: PauseMap | undefined, date: string, tourId: string): PauseInfo | null {
  if (!map) return null;
  return map.get(`${date}|${tourId}`) ?? map.get(`${date}|*`) ?? null;
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  while (d.getTime() <= end.getTime()) {
    out.push(osloDateISO(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
