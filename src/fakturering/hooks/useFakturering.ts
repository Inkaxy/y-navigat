import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PreviewRow {
  invoicing_group: string | null;
  customer_count: number;
  order_count: number;
  sum_excl_vat: number;
  sum_incl_vat: number;
}

export function useInvoiceRunPreview(entityId: string | null, runDate: string) {
  return useQuery({
    queryKey: ["fakturering", "preview", entityId, runDate],
    enabled: !!entityId && !!runDate,
    queryFn: async (): Promise<PreviewRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_invoice_run_preview", {
        p_legal_entity_id: entityId,
        p_run_date: runDate,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        invoicing_group: r.invoicing_group ?? null,
        customer_count: Number(r.customer_count ?? 0),
        order_count: Number(r.order_count ?? 0),
        sum_excl_vat: Number(r.sum_excl_vat ?? 0),
        sum_incl_vat: Number(r.sum_incl_vat ?? 0),
      }));
    },
  });
}

export interface InvoiceSettings {
  legal_entity_id: string;
  internal_groups: string[];
  non_transfer_groups: string[];
}

export function useInvoiceSettings(entityId: string | null) {
  return useQuery({
    queryKey: ["fakturering", "settings", entityId],
    enabled: !!entityId,
    queryFn: async (): Promise<InvoiceSettings | null> => {
      const { data, error } = await supabase
        .from("invoice_settings")
        .select("legal_entity_id, internal_groups, non_transfer_groups")
        .eq("legal_entity_id", entityId!)
        .maybeSingle();
      if (error) throw error;
      return (data as any) ?? {
        legal_entity_id: entityId!,
        internal_groups: ["internal_outlets"],
        non_transfer_groups: ["test"],
      };
    },
  });
}

export function useTripletexTokenStatus(entityId: string | null) {
  return useQuery({
    queryKey: ["fakturering", "tripletex-status", entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tripletex_token_status", {
        _legal_entity_id: entityId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        hasConsumer: !!row?.has_consumer_token,
        hasEmployee: !!row?.has_employee_token,
        connected: !!row?.has_consumer_token && !!row?.has_employee_token,
      };
    },
    staleTime: 60 * 1000,
  });
}

export function useHasFakturaWriteAccess() {
  return useQuery({
    queryKey: ["fakturering", "write-access"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("has_app_write_access", {
        p_app_code: "faktura",
      });
      if (error) throw error;
      return !!data;
    },
    staleTime: 60 * 1000,
  });
}

export interface InvoiceRunRow {
  id: string;
  run_no: number | null;
  legal_entity_id: string;
  run_date: string;
  groups: string[];
  status: string;
  started_at: string | null;
  completed_at: string | null;
  basis_count: number;
  transferred_count: number;
  failed_count: number;
  skipped_count: number;
  total_incl_vat: number;
}

export function useRecentInvoiceRuns(entityId: string | null, limit = 5) {
  return useQuery({
    queryKey: ["fakturering", "runs", entityId, limit],
    enabled: !!entityId,
    queryFn: async (): Promise<InvoiceRunRow[]> => {
      const { data, error } = await supabase
        .from("invoice_runs")
        .select("*")
        .eq("legal_entity_id", entityId!)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r: any, idx) => ({
        ...r,
        run_no: r.run_no ?? r.sequence ?? null,
        _fallback_no: idx,
      }));
    },
  });
}

export async function useInvoiceRunTransferredStats(runId: string) {
  const { data, error } = await supabase
    .from("invoice_basis")
    .select("status")
    .eq("run_id", runId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ status: string }>;
  return {
    total: rows.length,
    transferred: rows.filter((r) => r.status === "transferred" || r.status === "invoiced").length,
    invoiced: rows.filter((r) => r.status === "invoiced").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "error").length,
  };
}
