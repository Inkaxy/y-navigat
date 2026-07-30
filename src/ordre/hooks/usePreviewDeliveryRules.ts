// Én sannhet for leveringsregel-preview i alle ordreflater.
// Kaller SQL-motoren `evaluate_delivery_rules` (SECURITY DEFINER)
// og henter automatisk customer_group_ids + product_group_ids
// slik at gruppe-scopede regler faktisk treffer.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";

export type DeliveryRuleEffect = "block" | "warn" | "info";

export type DeliveryRuleHit = {
  rule_id: string;
  rule_name: string;
  rule_type: string;
  effect: DeliveryRuleEffect;
  priority: number;
  matched: boolean;
  message: string;
};

export type PreviewDeliveryRulesInput = {
  legalEntityId: string;
  customerId: string | null;
  deliveryDate: string | null; // YYYY-MM-DD
  deliveryTourId?: string | null;
  productIds?: string[];
  orderedAt?: string; // ISO — default now
  existingOrderId?: string | null;
};

export type PreviewDeliveryRulesResult = {
  hits: DeliveryRuleHit[];
  blocks: DeliveryRuleHit[];
  warns: DeliveryRuleHit[];
  infos: DeliveryRuleHit[];
  canSave: boolean;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
};

const EMPTY_HITS: DeliveryRuleHit[] = [];

async function fetchCustomerGroups(customerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("customer_group_members")
    .select("group_id")
    .eq("customer_id", customerId);
  if (error) throw error;
  return (data ?? []).map((r: { group_id: string }) => r.group_id);
}

async function fetchProductGroups(productIds: string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  const { data, error } = await supabase
    .from("product_sales_groups")
    .select("sales_group_id")
    .in("product_id", productIds);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of data ?? []) set.add((r as { sales_group_id: string }).sales_group_id);
  return Array.from(set);
}

export function usePreviewDeliveryRules(
  input: PreviewDeliveryRulesInput,
): PreviewDeliveryRulesResult {
  const debouncedProductIds = useDebouncedValue(input.productIds ?? [], 300);
  const debouncedDate = useDebouncedValue(input.deliveryDate, 200);
  const debouncedTour = useDebouncedValue(input.deliveryTourId ?? null, 200);

  const query = useQuery({
    queryKey: [
      "preview-delivery-rules",
      input.legalEntityId,
      input.customerId,
      debouncedDate,
      debouncedTour,
      debouncedProductIds,
      input.existingOrderId ?? null,
    ],
    enabled: !!input.customerId && !!debouncedDate,
    staleTime: 15_000,
    queryFn: async (): Promise<DeliveryRuleHit[]> => {
      const [customerGroupIds, productGroupIds] = await Promise.all([
        fetchCustomerGroups(input.customerId!),
        fetchProductGroups(debouncedProductIds),
      ]);

      const { data, error } = await supabase.rpc("evaluate_delivery_rules", {
        p_legal_entity_id: input.legalEntityId,
        p_customer_id: input.customerId!,
        p_customer_group_ids: (customerGroupIds.length > 0 ? customerGroupIds : null) as string[],
        p_delivery_date: debouncedDate!,
        p_delivery_tour_id: debouncedTour as string,
        p_product_ids: (debouncedProductIds.length > 0 ? debouncedProductIds : null) as string[],
        p_product_group_ids: (productGroupIds.length > 0 ? productGroupIds : null) as string[],
        p_ordered_at: input.orderedAt ?? new Date().toISOString(),
        p_existing_order_id: (input.existingOrderId ?? null) as string,
      });
      if (error) throw error;
      return ((data ?? []) as DeliveryRuleHit[]).filter((h) => h.matched);
    },
  });

  const hits = query.data ?? EMPTY_HITS;
  const blocks = hits.filter((h) => h.effect === "block");
  const warns = hits.filter((h) => h.effect === "warn");
  const infos = hits.filter((h) => h.effect === "info");

  return {
    hits,
    blocks,
    warns,
    infos,
    canSave: blocks.length === 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}
