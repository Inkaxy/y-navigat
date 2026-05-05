import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PackingArea } from "../types";

/**
 * Henter ALLE pakkeområder for valgt selskap (både aktive og arkiverte).
 * UI filtrerer i tabellen — vi ønsker telling for begge buckets.
 */
export function usePackingAreas(legalEntityId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["packing_areas", legalEntityId ?? null],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<PackingArea[]> => {
      const { data, error } = await supabase
        .from("packing_areas")
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .order("display_order", { ascending: true })
        .order("display_name", { ascending: true });

      if (error) throw error;
      return (data ?? []) as PackingArea[];
    },
  });

  // Realtime — invalidér ved enhver endring i selskapets pakkeområder.
  useEffect(() => {
    if (!legalEntityId) return;
    const channel = supabase
      .channel(`packing_areas:${legalEntityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "packing_areas",
          filter: `legal_entity_id=eq.${legalEntityId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["packing_areas", legalEntityId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [legalEntityId, qc]);

  return query;
}

/**
 * Teller hvor mange product_packing_areas-koblinger som peker på et pakkeområde.
 * Brukes for å avgjøre om "code" kan endres og for å vise advarsel ved arkivering.
 */
export function usePackingAreaUsage(packingAreaId: string | undefined) {
  return useQuery({
    queryKey: ["packing_area_usage", packingAreaId ?? null],
    enabled: !!packingAreaId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("product_packing_areas")
        .select("id", { count: "exact", head: true })
        .eq("packing_area_id", packingAreaId!);

      if (error) throw error;
      return count ?? 0;
    },
  });
}
