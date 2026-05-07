import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ActivePause = {
  id: string;
  customer_id: string;
  pause_from: string;
  pause_to: string | null;
  reason: string | null;
  tour_filter: string[] | null;
  customer_display_name: string;
  customer_number: string;
};

/** Hent aktive leveransepauser for (legal_entity, dato). */
export function useActivePauses(legalEntityId: string, isoDate: string) {
  return useQuery({
    queryKey: ["active-pauses", legalEntityId, isoDate],
    queryFn: async (): Promise<ActivePause[]> => {
      const { data: pauses, error } = await supabase
        .from("delivery_pauses")
        .select("id, customer_id, pause_from, pause_to, reason, tour_filter")
        .eq("legal_entity_id", legalEntityId)
        .lte("pause_from", isoDate)
        .or(`pause_to.is.null,pause_to.gte.${isoDate}`);
      if (error) throw error;
      const rows = pauses ?? [];
      if (rows.length === 0) return [];

      const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)));
      const { data: customers, error: cErr } = await supabase
        .from("customers")
        .select("id, display_name, customer_number")
        .in("id", customerIds);
      if (cErr) throw cErr;
      const cMap = new Map((customers ?? []).map((c) => [c.id, c]));

      return rows
        .map((r) => {
          const c = cMap.get(r.customer_id);
          return {
            id: r.id,
            customer_id: r.customer_id,
            pause_from: r.pause_from,
            pause_to: r.pause_to,
            reason: r.reason,
            tour_filter: (r as { tour_filter: string[] | null }).tour_filter ?? null,
            customer_display_name: c?.display_name ?? "Ukjent kunde",
            customer_number: c?.customer_number ?? "",
          } satisfies ActivePause;
        })
        .sort((a, b) => a.customer_display_name.localeCompare(b.customer_display_name, "nb"));
    },
    staleTime: 30_000,
  });
}
