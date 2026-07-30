import { useQuery, useQueryClient } from "@tanstack/react-query";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { osloTodayISO } from "@/lib/osloDate";

export type ProductLookup = {
  id: string;
  display_name: string;
  display_number: number;
  unit_of_sale: string;
  /** Standardsats / takeaway-sats. */
  mva_rate: number;
  /** Sitt her-sats. NULL = ikke matvare, samme sats uansett. */
  eatin_mva_rate: number | null;
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
        const today = osloTodayISO();
        const [pRes, pliRes] = await Promise.all([
          kioskSupabase
            .from("products")
            .select("id, display_name, pos_display_name, display_number, unit_of_sale, mva_rate, eatin_mva_rate")
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
        const eatinRaw = (pRes.data as { eatin_mva_rate?: number | null })
          .eatin_mva_rate;
        const eatin_mva_rate =
          eatinRaw == null || eatinRaw === undefined ? null : Number(eatinRaw);
        // For pricelister med mva inkludert: bruk takeaway-sats (mva) som basis
        // — sitt her-tillegget bokføres separat på linje-MVA, ikke i pris.
        const unit_price_excl_mva = pricesIncludeMva
          ? raw / (1 + mva / 100)
          : raw;
        return {
          id: pRes.data.id,
          display_name: (pRes.data as any).pos_display_name?.trim() || pRes.data.display_name,
          display_number: Number(pRes.data.display_number),
          unit_of_sale: pRes.data.unit_of_sale,
          mva_rate: mva,
          eatin_mva_rate,
          unit_price_excl_mva,
        };
      },
    });
  };
}
