import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WizardData } from "./types";

/**
 * Loads the full wizard config for a category via the `get_cake_category_wizard`
 * RPC and subscribes to Supabase Realtime so the wizard re-renders live when
 * admins edit categories, steps, building blocks, prices, or rules.
 */
export function useWizardConfig(args: {
  categoryId: string;
  priceListId: string;
  onConfigUpdated?: () => void;
}) {
  const { categoryId, priceListId, onConfigUpdated } = args;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["cake-builder-wizard", categoryId, priceListId] as const,
    [categoryId, priceListId],
  );

  const query = useQuery<WizardData>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cake_category_wizard", {
        p_category_id: categoryId,
        p_price_list_id: priceListId,
      });
      if (error) throw error;
      return (data ?? { category: null, price_list: null, steps: [], rules: [] }) as unknown as WizardData;
    },
    enabled: Boolean(categoryId && priceListId),
    staleTime: 30_000,
  });

  // Track current step ids + product ids so we can filter postgres_changes events client-side.
  // (postgres_changes does not support `IN`-style filters, so we subscribe to all events on
  //  these tables and filter in the handlers.)
  const currentStepIdsRef = useRef<Set<string>>(new Set());
  const currentProductIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const stepIds = new Set<string>();
    const productIds = new Set<string>();
    for (const step of query.data?.steps ?? []) {
      stepIds.add(step.id);
      for (const opt of step.options) {
        if (opt.product_id) productIds.add(opt.product_id);
      }
    }
    currentStepIdsRef.current = stepIds;
    currentProductIdsRef.current = productIds;
  }, [query.data]);

  // Debounced refetch to avoid spam during batch edits.
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRefetch = () => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey });
      onConfigUpdated?.();
    }, 500);
  };

  useEffect(() => {
    if (!categoryId || !priceListId) return;
    const channel = supabase
      .channel(`cake-builder-${categoryId}-${priceListId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cake_categories", filter: `id=eq.${categoryId}` },
        triggerRefetch,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cake_steps", filter: `cake_category_id=eq.${categoryId}` },
        triggerRefetch,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cake_step_products" },
        (payload) => {
          const newRow = payload.new as { cake_step_id?: string } | null;
          const oldRow = payload.old as { cake_step_id?: string } | null;
          const stepId = newRow?.cake_step_id ?? oldRow?.cake_step_id;
          if (stepId && currentStepIdsRef.current.has(stepId)) triggerRefetch();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cake_compatibility_rules",
          filter: `cake_category_id=eq.${categoryId}`,
        },
        triggerRefetch,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "price_list_items",
          filter: `price_list_id=eq.${priceListId}`,
        },
        triggerRefetch,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "products", filter: "status=eq.active" },
        (payload) => {
          const newRow = payload.new as { id?: string } | null;
          const oldRow = payload.old as { id?: string } | null;
          const productId = newRow?.id ?? oldRow?.id;
          if (productId && currentProductIdsRef.current.has(productId)) triggerRefetch();
        },
      )
      .subscribe();

    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, priceListId]);

  return query;
}
