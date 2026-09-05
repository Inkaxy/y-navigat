import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EffectivePriceListSource = "kunde" | "profil" | "gruppe" | "standard";

export type EffectivePriceList = {
  id: string | null;
  display_name: string | null;
  source: EffectivePriceListSource;
};

const SOURCE_LABEL: Record<EffectivePriceListSource, string> = {
  kunde: "Satt på kunden",
  profil: "Arvet fra kundeprofilen",
  gruppe: "Fra kundegruppe/profilkobling",
  standard: "Standard prisliste",
};

export function effectivePriceListSourceLabel(source: EffectivePriceListSource): string {
  return SOURCE_LABEL[source];
}

/**
 * Kundens faktisk gjeldende prisliste via RPC `customer_effective_price_list`,
 * med kildeforklaring (kunde / profil / gruppe / standard).
 */
export function useEffectivePriceList(
  customerId: string | null | undefined,
  customerPriceListId: string | null | undefined,
  profilePriceListId: string | null | undefined,
) {
  return useQuery({
    queryKey: [
      "customer-effective-price-list",
      customerId,
      customerPriceListId ?? null,
      profilePriceListId ?? null,
    ],
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async (): Promise<EffectivePriceList> => {
      const { data: id, error } = await supabase.rpc("customer_effective_price_list", {
        _customer_id: customerId!,
      });
      if (error) throw error;
      const priceListId = (id as string | null) ?? null;
      if (!priceListId) return { id: null, display_name: null, source: "standard" };

      const { data: pl, error: plErr } = await supabase
        .from("price_lists")
        .select("id, display_name, is_default")
        .eq("id", priceListId)
        .maybeSingle();
      if (plErr) throw plErr;

      let source: EffectivePriceListSource = "gruppe";
      if (customerPriceListId && customerPriceListId === priceListId) source = "kunde";
      else if (profilePriceListId && profilePriceListId === priceListId) source = "profil";
      else if (pl?.is_default) source = "standard";

      return { id: priceListId, display_name: pl?.display_name ?? null, source };
    },
  });
}
