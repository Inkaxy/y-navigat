import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { parseCostPriceSource, type CostDeviation } from "@/ravarer/lib/costPriceSource";

/** Gjeldende kostpris med kilde (faktura, leverandør, dato) fra serverens prisvelger. */
export function useCostPriceSource(rawMaterialId: string | null | undefined) {
  return useQuery({
    queryKey: ["rm-cost-source", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_cost_price_source", { p_raw_material_id: rawMaterialId as string });
      if (error) throw new Error("Kunne ikke hente kilden til kostprisen");
      return parseCostPriceSource(data);
    },
  });
}

/** Råvarer der lagret kostpris avviker fra nyeste gyldige pris, eller mangler gyldig kilde. */
export function useCostDeviations(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["rm-cost-deviations", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<CostDeviation[]> => {
      const { data, error } = await supabase.rpc("rm_cost_price_deviations", { p_legal_entity_id: legalEntityId as string });
      if (error) throw new Error("Kunne ikke hente avvikene");
      return (data ?? []).map((r) => ({
        rawMaterialId: r.raw_material_id, name: r.name, baseUnit: r.base_unit,
        currentPrice: r.current_price, status: r.status === "uverifisert" ? "uverifisert" : "avviker",
        sourcePrice: r.source_price, sourceDate: r.source_date, supplierName: r.supplier_name,
        invoiceId: r.invoice_id, invoiceNumber: r.invoice_number,
      }));
    },
  });
}

/** Brukerstyrt: sett valgte råvarer til nyeste gyldige pris (ingen automatisk masseendring). */
export function useRefreshCostPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc("rm_refresh_cost_prices", { p_raw_material_ids: ids });
      if (error) throw new Error(error.message.startsWith("Ingen skrivetilgang") ? "Du har ikke skrivetilgang til alle valgte råvarer" : "Kostprisene ble ikke oppdatert. Prøv igjen.");
      const o = data && typeof data === "object" && !Array.isArray(data) ? data : {};
      const changed = "changed" in o && typeof o.changed === "number" ? o.changed : 0;
      return { changed };
    },
    onSettled: () => invalidateRawMaterial(qc),
  });
}
