import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export type OrderDeadlineViolation = {
  rule_id: string;
  rule_name: string;
  deadline_timestamp: string;
  is_passed: boolean;
  minutes_over: number;
};

type Args = {
  legalEntityId: string;
  customerId: string | null;
  deliveryDate: string | null;
  deliveryTourId?: string | null;
  productIds?: string[];
};

export function useOrderDeadlineCheck({
  legalEntityId,
  customerId,
  deliveryDate,
  deliveryTourId,
  productIds,
}: Args) {
  // Debounce produkter (de endres mye under inntasting)
  const debouncedProductIds = useDebouncedValue(productIds ?? [], 400);

  return useQuery({
    queryKey: [
      "order-deadline-check",
      legalEntityId,
      customerId,
      deliveryDate,
      deliveryTourId ?? null,
      debouncedProductIds,
    ],
    enabled: !!customerId && !!deliveryDate,
    staleTime: 30_000,
    queryFn: async (): Promise<OrderDeadlineViolation[]> => {
      const { data, error } = await supabase.rpc("check_order_deadline_violations", {
        p_legal_entity_id: legalEntityId,
        p_customer_id: customerId!,
        p_delivery_date: deliveryDate!,
        p_delivery_tour_id: deliveryTourId ?? undefined,
        p_product_ids: debouncedProductIds.length > 0 ? debouncedProductIds : undefined,
      });
      if (error) throw error;
      return (data ?? []) as OrderDeadlineViolation[];
    },
  });
}
