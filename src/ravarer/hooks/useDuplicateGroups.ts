import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRowsExact } from "@/lib/countedPaging";
import { useRavarerScope } from "@/ravarer/hooks/useRavarerScope";
import { findDuplicateGroups, type DupItem, type DupLink } from "@/ravarer/lib/merge/duplicates";

type RmsRow = { id: string; raw_material_id: string; supplier_id: string; supplier_sku: string | null; supplier_product_name: string | null };
type AliasRow = { id: string; raw_material_supplier_id: string; alias_value: string };

/**
 * «Mulige duplikater»: alle leverandørkoblinger og bekreftede lærte varenumre (komplett henting), gruppert av
 * `findDuplicateGroups`. Virker uten databaseendringen; selve sammenslåingen krever den.
 */
export function useDuplicateGroups(items: readonly DupItem[], supplierName: (id: string) => string | null, enabled: boolean) {
  const { legalEntityId } = useRavarerScope();
  const links = useQuery({
    queryKey: ["ravarer", "duplicate-links", legalEntityId],
    enabled: enabled && !!legalEntityId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const rms = await fetchAllRowsExact<RmsRow>((from, to) => supabase.from("raw_material_suppliers")
        .select("id, raw_material_id, supplier_id, supplier_sku, supplier_product_name", { count: "exact" }).order("id").range(from, to), 1000, signal);
      const aliases = await fetchAllRowsExact<AliasRow>((from, to) => supabase.from("raw_material_supplier_aliases")
        .select("id, raw_material_supplier_id, alias_value", { count: "exact" }).eq("alias_type", "supplier_sku").eq("status", "confirmed").order("id").range(from, to), 1000, signal);
      return { rms, aliases };
    },
  });
  const groups = useMemo(() => {
    if (!links.data) return null;
    const byRms = new Map<string, string[]>();
    for (const a of links.data.aliases) byRms.set(a.raw_material_supplier_id, [...(byRms.get(a.raw_material_supplier_id) ?? []), a.alias_value]);
    const ids = new Set(items.map((i) => i.id));
    const dl: DupLink[] = links.data.rms.filter((r) => ids.has(r.raw_material_id)).map((r) => ({
      raw_material_id: r.raw_material_id, supplier_id: r.supplier_id, supplier_name: supplierName(r.supplier_id),
      supplier_sku: r.supplier_sku, supplier_product_name: r.supplier_product_name, sku_aliases: byRms.get(r.id) ?? [],
    }));
    return findDuplicateGroups(items, dl);
  }, [links.data, items, supplierName]);
  return { groups, isLoading: links.isLoading, isError: links.isError, refetch: links.refetch };
}
