import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseWorkItems } from "@/ravarer/lib/workRpc";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";
import type { HoldState } from "@/fakturaer/lib/financialPresentation";

type HoldLine = { supplier_sku?: string | null; description?: string | null; requires_review?: boolean | null };

/**
 * Hvilke leverandørvarer har en prisobservasjon holdt tilbake? Holdtabellen er ikke
 * lesbar for klienten; vi leser serverens kø (rm_work_items, read_integrity_flags).
 * Ukjent (lasting/feil/åpen linje uten køtreff) gir `null` — da vises ingen prispåstand.
 */
export function usePriceHolds(legalEntityId: string | null, supplierId: string | null) {
  const q = useQuery({
    queryKey: ["price-holds", legalEntityId, supplierId],
    enabled: !!legalEntityId && !!supplierId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_work_items", {
        p_legal_entity_id: legalEntityId as string, p_group: "alle", p_supplier_id: supplierId as string, p_limit: 500, p_offset: 0,
      });
      if (error) throw error;
      const r = parseWorkItems(data);
      const flags = new Map<string, boolean>();
      for (const it of r.items) if (it.type === "varekort" && it.item_key) flags.set(it.item_key, it.read_integrity_flags.includes("price_observation_held"));
      return flags;
    },
  });
  const heldFor = (line: HoldLine): HoldState => {
    if (!q.data) return null;
    const key = supplierItemKey(line);
    const hit = key ? q.data.get(key) : undefined;
    if (hit !== undefined) return hit;
    // Ikke i køen: avsluttede linjer har ingen åpen prisbeslutning; åpne linjer er ukjent.
    return line.requires_review ? null : false;
  };
  return { heldFor, isError: q.isError };
}
