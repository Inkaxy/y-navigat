import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const skuNorm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Varenumre hos én leverandør → varer (leverandørkoblingens varenummer + bekreftede lærte varenumre).
 * Brukes av Nye varer til «Samme varenummer» slik at en vare som alt finnes ikke opprettes på nytt.
 * Feil gir feil (ikke tomt): raden faller da tilbake til navneforslag og sier fra.
 */
export function useSupplierSkuIndex(supplierId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ravarer", "fra-faktura", "supplier-skus", supplierId],
    enabled: enabled && !!supplierId,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, string[]>> => {
      const { data, error } = await supabase.from("raw_material_suppliers").select("id, raw_material_id, supplier_sku").eq("supplier_id", supplierId).order("id").limit(5000);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length >= 5000) throw new Error("For mange leverandørkoblinger til å sjekke varenummer.");
      const index = new Map<string, string[]>();
      const add = (sku: string | null | undefined, rm: string) => {
        const k = skuNorm(sku);
        if (!k) return;
        const list = index.get(k) ?? [];
        if (!list.includes(rm)) list.push(rm);
        index.set(k, list);
      };
      const rmOf = new Map<string, string>();
      for (const r of rows) { add(r.supplier_sku, r.raw_material_id); rmOf.set(r.id, r.raw_material_id); }
      const ids = [...rmOf.keys()];
      for (let i = 0; i < ids.length; i += 100) {
        const { data: al, error: aErr } = await supabase.from("raw_material_supplier_aliases").select("raw_material_supplier_id, alias_value")
          .eq("alias_type", "supplier_sku").eq("status", "confirmed").in("raw_material_supplier_id", ids.slice(i, i + 100)).limit(1000);
        if (aErr) throw aErr;
        if ((al ?? []).length >= 1000) throw new Error("For mange lærte varenumre til å sjekke.");
        for (const a of al ?? []) { const rm = rmOf.get(a.raw_material_supplier_id); if (rm) add(a.alias_value, rm); }
      }
      return index;
    },
  });
}
