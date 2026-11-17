import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import {
  parseAcceptPrice, parseActivityFeed, parsePriceMovers, parseWorkItems, parseWorkSummary,
  type AcceptPriceResult, type WorkGroup, type WorkSort,
} from "@/ravarer/lib/workRpc";
import { subtractDays } from "@/ravarer/lib/workDates";
import { TRANSIENT_RETRY, workGate } from "@/ravarer/lib/heavyGate";
import type { WorkItemsCounts } from "@/ravarer/lib/workRpcTypes";

/**
 * Tellerne fra rm_work_items er like for alle grupper så lenge søk og leverandørfilter er tomme. Hvert slikt
 * listekall deler derfor tellerne sine med meny/faner (`useWorkCounts`), så én sidevisning gir ett tungt kall.
 */
const countSeeds = new Map<string, { counts: WorkItemsCounts; startedAt: number }>();
export const workCountsKey = (legalEntityId: string | null) => ["ravarer", "work-items", "counts", legalEntityId] as const;

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
    ...TRANSIENT_RETRY,
    // Samme port som rm_work_items: aldri flere tunge oppslag samtidig fra samme fane.
    queryFn: ({ signal }) => workGate.run(async () => {
      const { data, error } = await supabase.rpc("rm_work_summary", {
        p_legal_entity_id: legalEntityId!, p_include_approval: includeApproval,
      });
      if (error) throw error;
      return parseWorkSummary(data);
    }, { signal }),
  });
}

export type WorkItemsParams = {
  group?: WorkGroup; search?: string | null; supplierId?: string | null; sort?: WorkSort;
  limit?: number; offset?: number; enabled?: boolean;
};

export function useWorkItems({ group = "alle", search = null, supplierId = null, sort = "oldest", limit = 50, offset = 0, enabled = true }: WorkItemsParams = {}) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "work-items", legalEntityId, group, search, supplierId, sort, limit, offset],
    enabled: enabled && !!legalEntityId,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    ...TRANSIENT_RETRY,
    queryFn: ({ signal }) => fetchWorkItems(qc, legalEntityId!, { group, search, supplierId, sort, limit, offset }, signal),
  });
}

/** Ett rm_work_items-kall gjennom porten. Ufiltrerte svar deler tellerne sine med `useWorkCounts`. */
export function fetchWorkItems(
  qc: QueryClient, legalEntityId: string,
  p: WorkItemsCall, signal?: AbortSignal,
) {
  return workGate.run(() => rawWorkItems(qc, legalEntityId, p), { signal });
}

type WorkItemsCall = { group: WorkGroup; search?: string | null; supplierId?: string | null; sort: WorkSort; limit: number; offset: number };

/** Selve kallet (uten port – kalleren holder porten). */
async function rawWorkItems(qc: QueryClient, legalEntityId: string, p: WorkItemsCall) {
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc("rm_work_items", {
    p_legal_entity_id: legalEntityId, p_group: p.group, p_search: p.search || undefined,
    p_supplier_id: p.supplierId || undefined, p_sort: p.sort, p_limit: p.limit, p_offset: p.offset,
  });
  if (error) throw error;
  const r = parseWorkItems(data);
  if (!p.search && !p.supplierId) {
    const prev = countSeeds.get(legalEntityId);
    if (!prev || prev.startedAt <= startedAt) {
      countSeeds.set(legalEntityId, { counts: r.counts, startedAt });
      qc.setQueryData(workCountsKey(legalEntityId), r.counts);
    }
  }
  return r;
}

/**
 * Tellerne for meny, faner og «åpne spørsmål» (rm_work_items-tellerne). Lav prioritet i porten: har en liste
 * på samme side hentet ferske tellere etter at dette kallet ble bestilt, brukes de og ingen nye kall sendes.
 */
export function useWorkCounts(enabled = true) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  return useQuery({
    queryKey: workCountsKey(legalEntityId),
    enabled: enabled && !!legalEntityId,
    staleTime: 120_000,
    ...TRANSIENT_RETRY,
    queryFn: ({ signal }) => {
      const requestedAt = Date.now();
      return workGate.run(async () => {
        const seed = countSeeds.get(legalEntityId!);
        if (seed && seed.startedAt >= requestedAt) return seed.counts;
        return (await rawWorkItems(qc, legalEntityId!, { group: "alle", sort: "oldest", limit: 1, offset: 0 })).counts;
      }, { low: true, signal });
    },
  });
}

export function useActivityFeed({ days = 7, limit = 50, enabled = true }: { days?: number; limit?: number; enabled?: boolean } = {}) {
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "activity-feed", legalEntityId, days, limit],
    enabled: enabled && !!legalEntityId,
    refetchOnWindowFocus: true,
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
    refetchOnWindowFocus: true,
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
      void qc.invalidateQueries({ queryKey: ["supplier-item-lines"] });
      void qc.invalidateQueries({ queryKey: ["rematch-status"] });
    },
  });
}
