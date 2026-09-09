import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { osloTodayISO } from "@/lib/osloDate";

/**
 * Varer som ligger under marginmålet i standard prisliste.
 * Regnes av `profitability_sheet` i databasen, slik at dashbordet, menyen og
 * varekortet viser samme tall.
 */
export interface MarginAlert {
  product_id: string;
  navn: string | null;
  display_number: number | null;
  dg2_pct: number | null;
  maal_dg2_pct: number | null;
  avvik_pp: number | null;
  pris: number | null;
  nodvendig_pris: number | null;
}

const DEFAULT_LIST_CODE = "nb_butikker";

export function useMarginAlerts(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["margin-alerts", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 60_000,
    queryFn: async (): Promise<MarginAlert[]> => {
      const { data: lists, error: lErr } = await supabase
        .from("price_lists")
        .select("id, code")
        .eq("legal_entity_id", legalEntityId!)
        .not("price_level", "is", null)
        .order("display_name");
      if (lErr) throw lErr;
      const listId = (lists ?? []).find((l) => l.code === DEFAULT_LIST_CODE)?.id ?? lists?.[0]?.id;
      if (!listId) return [];

      const { data, error } = await supabase.rpc("profitability_sheet", {
        p_price_list_id: listId,
        p_date: osloTodayISO(),
      });
      if (error) throw error;
      const rows = (data ?? []) as unknown as (MarginAlert & { status: string | null })[];
      return rows
        .filter((r) => r.status === "rod" && r.avvik_pp != null)
        .sort((a, b) => (a.avvik_pp ?? 0) - (b.avvik_pp ?? 0));
    },
  });
}
