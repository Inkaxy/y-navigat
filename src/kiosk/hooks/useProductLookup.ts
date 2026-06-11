import { useQuery, useQueryClient } from "@tanstack/react-query";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";

export type ProductLookup = {
  id: string;
  display_name: string;
  display_number: number;
  unit_of_sale: string;
  mva_rate: number;
  unit_price_excl_mva: number;
};

export function usePriceListConfig(priceListId: string | null) {
  return useQuery({
    queryKey: ["kiosk-price-list", priceListId],
    enabled: !!priceListId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await kioskSupabase
        .from("price_lists")
        .select("id, display_name, prices_include_mva")
        .eq("id", priceListId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Returnerer en async-funksjon som henter produkt + pris fra default-prisliste.
 * Cacher 5 min per (priceListId, productId).
 * Returnerer null hvis produkt eller pris ikke finnes.
 */
export function useProductLookup(
  priceListId: string | null,
  pricesIncludeMva: boolean,
) {
  const qc = useQueryClient();
  return async (productId: string): Promise<ProductLookup | null> => {
    if (!priceListId) return null;
    return qc.fetchQuery({
      queryKey: ["kiosk-product-lookup", priceListId, productId, pricesIncludeMva],
      staleTime: 5 * 60_000,
      queryFn: async (): Promise<ProductLookup | null> => {
        const today = new Date().toISOString().slice(0, 10);
        const [pRes, pliRes] = await Promise.all([
          kioskSupabase
            .from("products")
            .select("id, display_name, pos_display_name, display_number, unit_of_sale, mva_rate")
            .eq("id", productId)
            .maybeSingle(),
          kioskSupabase
            .from("price_list_items")
            .select("price, min_quantity, valid_from, valid_to")
            .eq("price_list_id", priceListId)
            .eq("product_id", productId)
            .lte("valid_from", today)
            .or(`valid_to.is.null,valid_to.gte.${today}`)
            .order("min_quantity", { ascending: true, nullsFirst: true })
            .limit(1),
        ]);
        if (pRes.error) throw pRes.error;
        if (pliRes.error) throw pliRes.error;
        if (!pRes.data) return null;
        const priceRow = pliRes.data?.[0];
        if (!priceRow) return null;
        const raw = Number(priceRow.price);
        const mva = Number(pRes.data.mva_rate) || 0;
        const unit_price_excl_mva = pricesIncludeMva
          ? raw / (1 + mva / 100)
          : raw;
        return {
          id: pRes.data.id,
          display_name: pRes.data.display_name,
          display_number: Number(pRes.data.display_number),
          unit_of_sale: pRes.data.unit_of_sale,
          mva_rate: mva,
          unit_price_excl_mva,
        };
      },
    });
  };
}
