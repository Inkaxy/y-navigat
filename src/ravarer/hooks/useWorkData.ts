import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import {
  parseAcceptPrice, parseActivityFeed, parsePriceMovers, parseWorkItems, parseWorkSummary,
  type AcceptPriceResult, type WorkGroup, type WorkSort,
} from "@/ravarer/lib/workRpc";
import { subtractDays } from "@/ravarer/lib/workDates";

/** Felles tellere for meny, Oversikt og faner. */
export function useWorkSummary({ includeApproval = true, enabled = true }: { includeApproval?: boolean; enabled?: boolean } = {}) {
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "work-summary", legalEntityId, includeApproval],
    enabled: enabled && !!legalEntityId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_work_summary", {
        p_legal_entity_id: legalEntityId!, p_include_approval: includeApproval,
      });
      if (error) throw error;
      return parseWorkSummary(data);
    },
  });
}

export type WorkItemsParams = {
  group?: WorkGroup; search?: string | null; supplierId?: string | null; sort?: WorkSort;
  limit?: number; offset?: number; enabled?: boolean;
};

export function useWorkItems({ group = "alle", search = null, supplierId = null, sort = "impact", limit = 50, offset = 0, enabled = true }: WorkItemsParams = {}) {
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "work-items", legalEntityId, group, search, supplierId, sort, limit, offset],
    enabled: enabled && !!legalEntityId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_work_items", {
        p_legal_entity_id: legalEntityId!, p_group: group, p_search: search || undefined,
        p_supplier_id: supplierId || undefined, p_sort: sort, p_limit: limit, p_offset: offset,
      });
      if (error) throw error;
      return parseWorkItems(data);
    },
  });
}

export function useActivityFeed({ days = 7, limit = 50, enabled = true }: { days?: number; limit?: number; enabled?: boolean } = {}) {
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "activity-feed", legalEntityId, days, limit],
    enabled: enabled && !!legalEntityId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_activity_feed", {
        p_legal_entity_id: legalEntityId!, p_since: subtractDays(new Date(), days).toISOString(), p_limit: limit,
      });
      if (error) throw error;
      return parseActivityFeed(data);
    },
  });
}

export function usePriceMovers({ days = 30, limit = 20, enabled = true }: { days?: number; limit?: number; enabled?: boolean } = {}) {
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "price-movers", legalEntityId, days, limit],
    enabled: enabled && !!legalEntityId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_price_movers", { p_legal_entity_id: legalEntityId!, p_days: days, p_limit: limit });
      if (error) throw error;
      return parsePriceMovers(data);
    },
  });
}

export type AcceptSupplierItemPriceInput = {
  supplierId: string; itemKey: string;
  lines?: { id: string; price_per_base_unit: number }[] | null; reason?: string | null;
};

/** Godta ny pris for et varekort (brukes fra fase 3). */
export function useAcceptSupplierItemPrice() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  return useMutation({
    mutationFn: async (input: AcceptSupplierItemPriceInput): Promise<AcceptPriceResult> => {
      if (!company?.id) throw new Error("Fant ikke selskapet.");
      const { data, error } = await supabase.rpc("rm_supplier_item_accept_price", {
        p_legal_entity_id: company.id, p_supplier_id: input.supplierId, p_item_key: input.itemKey,
        p_lines: input.lines ?? undefined, p_reason: input.reason ?? undefined,
      });
      if (error) throw new Error("Kunne ikke godta prisen. Prøv igjen.");
      const r = parseAcceptPrice(data);
      if (!r.ok) throw new Error(r.error ?? "Kunne ikke godta prisen.");
      return r;
    },
    onSuccess: () => {
      invalidateInvoice(qc);
      invalidateRavarerCounts(qc);
      void qc.invalidateQueries({ queryKey: ["supplier-items"] });
    },
  });
}
