import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";

export interface AllStockRow {
  raw_material_id: string;
  name: string;
  sku: string;
  base_unit: string;
  category: string | null;
  item_type: string;
  is_resale_item: boolean;
  current_stock: number;
  min_stock: number | null;
  current_cost_price: number | null;
  stock_value: number | null;
  last_in: string | null;
  last_out: string | null;
}

const num = (v: unknown, fallback = 0) => (v == null ? fallback : Number(v) || 0);

/** Alle lagerførte, aktive varer — fra visningen raw_material_stock_status. */
export function useAllStockStatus() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["raw-material-stock-status", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<AllStockRow[]> => {
      const { data, error } = await supabase
        .from("raw_material_stock_status")
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("name");
      if (error) throw error;
      return (data ?? [])
        .filter(r => r.raw_material_id != null)
        .map(r => ({
          raw_material_id: r.raw_material_id as string,
          name: r.name ?? "—",
          sku: r.sku ?? "",
          base_unit: r.base_unit ?? "",
          category: r.category ?? null,
          item_type: r.item_type ?? "ravare",
          is_resale_item: !!r.is_resale_item,
          current_stock: num(r.current_stock),
          min_stock: r.min_stock == null ? null : Number(r.min_stock),
          current_cost_price: r.current_cost_price == null ? null : Number(r.current_cost_price),
          stock_value: r.stock_value == null ? null : Number(r.stock_value),
          last_in: r.last_in ?? null,
          last_out: r.last_out ?? null,
        }));
    },
  });
}
