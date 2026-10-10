import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";

export interface MaterialChoice {
  id: string;
  name: string;
  base_unit: string | null;
  sku: string | null;
  category: string | null;
  why: string | null;
}

/** Forslag fra matchemotoren for én linje + søk i hele råvareregisteret. */
export function useMaterialChoices(lineId: string | null, search: string) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const q = useDebouncedValue(search.trim(), 250);

  const suggestions = useQuery({
    queryKey: ["supplier-item-suggestions", lineId],
    enabled: !!lineId,
    queryFn: async (): Promise<MaterialChoice[]> => {
      const { data, error } = await supabase
        .from("invoice_line_match_suggestions")
        .select("raw_material_id, match_reason, rank, raw_materials(name, base_unit, sku, category)")
        .eq("invoice_line_id", lineId!)
        .order("rank")
        .limit(3);
      if (error) throw error;
      return (data ?? []).map((s) => ({
        id: s.raw_material_id,
        name: s.raw_materials?.name ?? "Ukjent råvare",
        base_unit: s.raw_materials?.base_unit ?? null,
        sku: s.raw_materials?.sku ?? null,
        category: s.raw_materials?.category ?? null,
        why: s.match_reason,
      }));
    },
  });

  const results = useQuery({
    queryKey: ["supplier-item-rm-search", le, q],
    enabled: !!le && q.length > 1,
    queryFn: async (): Promise<MaterialChoice[]> => {
      const term = q.replace(/[%,()]/g, " ");
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, name, base_unit, sku, category")
        .eq("legal_entity_id", le!)
        .eq("is_active", true)
        .or(`name.ilike.%${term}%,sku.ilike.%${term}%`)
        .order("name")
        .limit(20);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, why: null }));
    },
  });

  return { suggestions, results };
}

export function useMaterialById(id: string | null) {
  return useQuery({
    queryKey: ["supplier-item-rm", id],
    enabled: !!id,
    queryFn: async (): Promise<MaterialChoice | null> => {
      const { data, error } = await supabase.from("raw_materials").select("id, name, base_unit, sku, category").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data ? { ...data, why: null } : null;
    },
  });
}
