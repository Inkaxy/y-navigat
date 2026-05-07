import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatrixProduct } from "@/ordre/hooks/useMatrix";

/** Lookup minimal product-info for given ids — brukes til ghost-rader (fastordre) som ikke finnes i matrix.products. */
export function useProductsByIds(ids: string[]) {
  const sortedKey = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["products-by-ids", sortedKey],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MatrixProduct[]> => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_number, code, display_name, unit_of_sale, mva_rate")
        .in("id", ids);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        display_number: Number(p.display_number),
        code: p.code ?? "",
        display_name: p.display_name,
        sales_unit: p.unit_of_sale ?? "stk",
        mva_rate: Number(p.mva_rate ?? 0),
        unit_price: null,
        price_source: "none",
      }));
    },
  });
}
