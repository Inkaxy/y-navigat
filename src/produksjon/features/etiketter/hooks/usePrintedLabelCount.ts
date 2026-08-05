import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LabelScreenFilter } from "../types";

/**
 * Antall unike varer som er skrevet ut (label_print_jobs) for valgt dato,
 * begrenset av legal_entity, valgte produksjonsavdelinger og varene som er
 * synlige i listen.
 */
export function usePrintedLabelCount(
  filter: LabelScreenFilter | null,
  productIds: string[],
) {
  const qc = useQueryClient();
  const key = [
    "label_print_jobs",
    "printed-count",
    filter?.legalEntityId ?? null,
    filter?.date ?? null,
    filter?.departmentIds ?? null,
    productIds,
  ] as const;

  useEffect(() => {
    if (!filter?.legalEntityId) return;
    const channel = supabase
      .channel(
        `${filter.legalEntityId}:label-jobs-count:${crypto.randomUUID()}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "label_print_jobs",
          filter: `legal_entity_id=eq.${filter.legalEntityId}`,
        },
        () => {
          qc.invalidateQueries({
            queryKey: ["label_print_jobs", "printed-count"],
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [filter?.legalEntityId, qc]);

  return useQuery({
    queryKey: key,
    enabled:
      !!filter && !!filter.legalEntityId && !!filter.date && productIds.length > 0,
    queryFn: async (): Promise<number> => {
      if (!filter) return 0;
      // Tell etter ordrens leveringsdato (ikke print-tidspunkt): etiketter for
      // i morgen printes ofte i dag.
      let q = supabase
        .from("label_print_jobs")
        .select(
          "product_id, order_line:order_lines!inner(order:orders!inner(delivery_date))",
        )
        .eq("legal_entity_id", filter.legalEntityId)
        .in("product_id", productIds)
        .eq("order_line.order.delivery_date", filter.date);

      if (filter.departmentIds && filter.departmentIds.length > 0) {
        q = q.in("production_department_id", filter.departmentIds);
      }

      const { data, error } = await q;
      if (error) throw error;
      const unique = new Set((data ?? []).map((r) => r.product_id as string));
      return unique.size;
    },
  });
}
