import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PriceBreakdown } from "./types";

/**
 * Calls `calculate_cake_price` RPC, debounced 300ms after selection changes.
 * Returns null until the first calculation completes.
 */
export function usePriceCalculation(args: {
  categoryId: string;
  priceListId: string;
  selectedOptionIds: string[];
}) {
  const { categoryId, priceListId, selectedOptionIds } = args;
  const [price, setPrice] = useState<PriceBreakdown | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // Use a stable key to detect actual selection changes
  const key = selectedOptionIds.slice().sort().join(",");

  useEffect(() => {
    if (!categoryId || !priceListId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsCalculating(true);
      const { data, error } = await supabase.rpc("calculate_cake_price", {
        p_category_id: categoryId,
        p_price_list_id: priceListId,
        p_selected_option_ids: selectedOptionIds,
      });
      if (cancelled) return;
      setIsCalculating(false);
      if (error) {
        console.error("calculate_cake_price failed", error);
        return;
      }
      setPrice(data as unknown as PriceBreakdown);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, priceListId, key]);

  return { price, isCalculating };
}
