import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Åpent marginvarsel fra `margin_alerts_open` — brukes til «Kvitter»-lister. */
export interface OpenMarginAlert {
  id: string;
  product_id: string | null;
  display_name: string | null;
  display_number: number | null;
  price_list_name: string | null;
  status_before: string | null;
  status_after: string | null;
  target_pct: number | null;
  dg2_before: number | null;
  dg2_after: number | null;
  created_at: string | null;
}

/** Åpne (ukvitterte) marginvarsler for selskapet — kilden til badgen og «Kvitter»-lista. */
export function useOpenMarginAlerts(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["margin-alerts-open", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 30_000,
    queryFn: async (): Promise<OpenMarginAlert[]> => {
      const { data, error } = await supabase
        .from("margin_alerts_open")
        .select(
          "id, product_id, display_name, display_number, price_list_name, status_before, status_after, target_pct, dg2_before, dg2_after, created_at",
        )
        .eq("legal_entity_id", legalEntityId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OpenMarginAlert[];
    },
  });
}

/** Kvitterer et marginvarsel — setter `acknowledged_at`/`acknowledged_by` på raden i `margin_alerts`. */
export function useAcknowledgeMarginAlert(legalEntityId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("margin_alerts")
        .update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: userData.user?.id ?? null,
        })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["margin-alerts-open", legalEntityId] });
      qc.invalidateQueries({ queryKey: ["margin-alerts", legalEntityId] });
    },
  });
}
