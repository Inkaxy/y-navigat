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
  attach_vedlegg: boolean;
}

export function useInvoiceSettings(entityId: string | null) {
  return useQuery({
    queryKey: ["fakturering", "settings", entityId],
    enabled: !!entityId,
    queryFn: async (): Promise<InvoiceSettings | null> => {
      const { data, error } = await supabase
        .from("invoice_settings")
        .select("legal_entity_id, internal_groups, non_transfer_groups, attach_vedlegg")
        .eq("legal_entity_id", entityId!)
        .maybeSingle();
      if (error) throw error;
      return (data as any) ?? {
        legal_entity_id: entityId!,
        internal_groups: ["internal_outlets"],
        non_transfer_groups: ["test"],
        attach_vedlegg: true,
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
  run_no?: number | null;

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
      return (data ?? []).map((r: any) => ({ ...r, run_no: r.run_no ?? r.sequence ?? null }));
    },
  });
}

export function useInvoiceRun(runId: string | undefined) {
  return useQuery({
    queryKey: ["fakturering", "run", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_runs")
        .select("*")
        .eq("id", runId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown) as InvoiceRunRow | null;
    },
    // Poll while running OR pending (transfer just started, run still 'pending')
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "running" || s === "pending" ? 2000 : false;
    },
  });
}

export function useAllInvoiceRuns(entityId: string | null) {
  return useQuery({
    queryKey: ["fakturering", "runs-all", entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_runs")
        .select("*")
        .eq("legal_entity_id", entityId!)
        .order("started_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as unknown) as InvoiceRunRow[];
    },
  });
}

/** Antall invoice_basis med status='invoiced' per run_id, for gjeldende enhet. */
export function useRunInvoicedCounts(entityId: string | null) {
  return useQuery({
    queryKey: ["fakturering", "run-invoiced-counts", entityId],
    enabled: !!entityId,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from("invoice_basis")
        .select("run_id")
        .eq("legal_entity_id", entityId!)
        .eq("status", "invoiced")
        .limit(50000);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of (data ?? []) as any[]) map.set(r.run_id, (map.get(r.run_id) ?? 0) + 1);
      return map;
    },
    staleTime: 30_000,
  });
}

export interface BasisRow {
  id: string;
  run_id: string;
  legal_entity_id: string;
  customer_id: string;
  basis_number: string;
  invoicing_group: string;
  payment_terms_days: number | null;
  do_transfer: boolean;
  status: string;
  transfer_error: string | null;
  sum_excl_vat: number;
  sum_vat: number;
  sum_incl_vat: number;
  tripletex_customer_id: number | null;
  tripletex_order_id: number | null;
  tripletex_order_number?: string | null;
  tripletex_invoice_id: number | null;
  tripletex_invoice_number: string | null;
  tripletex_invoice_date: string | null;
  transferred_at: string | null;
  invoiced_at: string | null;
  created_at: string;
  attachment_path: string | null;
  attachment_generated_at: string | null;
  attachment_error: string | null;
  attachment_uploaded_at: string | null;
  customer?: {
    id: string;
    display_name: string;
    customer_number: string;
    invoice_method: string | null;
    invoice_attachment?: string | null;
    include_attachments_in_ehf?: boolean | null;
  } | null;
  run?: { id: string; run_date: string; started_at: string | null } | null;
  _order_count?: number;
}

export async function getAttachmentSignedUrl(path: string, expiresSec = 60): Promise<string> {
  const { data, error } = await supabase.storage.from("invoice-attachments").createSignedUrl(path, expiresSec);
  if (error) throw error;
  return data.signedUrl;
}

export async function regenerateAttachment(input: { run_id?: string; basis_id?: string }): Promise<void> {
  const { error } = await supabase.functions.invoke("fakturering-generate-vedlegg", { body: input });
  if (error) throw error;
}

/** Kun (re)opplasting av vedlegg for allerede overførte grunnlag. */
export async function uploadRunAttachments(runId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("fakturering-transfer-run", {
    body: { run_id: runId, only_attachments: true },
  });
  if (error) throw error;
}

async function attachOrderCounts(bases: any[]): Promise<any[]> {
  if (bases.length === 0) return bases;
  const ids = bases.map((b) => b.id);
  const { data } = await supabase
    .from("invoice_basis_orders")
    .select("basis_id")
    .in("basis_id", ids);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as any[]) counts.set(r.basis_id, (counts.get(r.basis_id) ?? 0) + 1);
  return bases.map((b) => ({ ...b, _order_count: counts.get(b.id) ?? 0 }));
}

export function useBasesForRun(runId: string | undefined, isRunning: boolean = false) {
  return useQuery({
    queryKey: ["fakturering", "run-bases", runId],
    enabled: !!runId,
    queryFn: async (): Promise<BasisRow[]> => {
      const { data, error } = await supabase
        .from("invoice_basis")
        .select(`*, customer:customer_id(id, display_name, customer_number, invoice_method, invoice_attachment, include_attachments_in_ehf)`)
        .eq("run_id", runId!)
        .order("basis_number", { ascending: true });
      if (error) throw error;
      return (await attachOrderCounts(data ?? [])) as BasisRow[];
    },
    refetchInterval: isRunning ? 4000 : false,
  });
}

export interface BasisDetails {
  lines: Array<{
    id: string;
    line_number: number;
    product_number: string | null;
    description: string;
    iso_week: number | null;
    quantity: number;
    sales_unit: string | null;
    unit_price_excl_vat: number | null;
    vat_rate: number;
    line_excl_vat: number;
    line_vat: number;
    line_incl_vat: number;
  }>;
  orders: Array<{ order_id: string; order_number: string | null; delivery_date: string | null; total_incl_vat: number | null }>;
}

export function useBasisDetails(basisId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["fakturering", "basis-details", basisId],
    enabled: enabled && !!basisId,
    queryFn: async (): Promise<BasisDetails> => {
      const [linesRes, ordersRes] = await Promise.all([
        supabase.from("invoice_basis_lines").select("*").eq("basis_id", basisId!).order("line_number"),
        supabase.from("invoice_basis_orders").select("order_id").eq("basis_id", basisId!),
      ]);
      if (linesRes.error) throw linesRes.error;
      if (ordersRes.error) throw ordersRes.error;
      const orderIds = (ordersRes.data ?? []).map((r: any) => r.order_id);
      let orderRows: any[] = [];
      if (orderIds.length > 0) {
        const { data } = await supabase
          .from("orders")
          .select("id, order_number, delivery_date, total_incl_vat")
          .in("id", orderIds);
        orderRows = data ?? [];
      }
      return {
        lines: (linesRes.data ?? []) as any,
        orders: orderRows.map((o) => ({
          order_id: o.id,
          order_number: o.order_number ?? null,
          delivery_date: o.delivery_date ?? null,
          total_incl_vat: o.total_incl_vat ?? null,
        })),
      };
    },
  });
}

export interface SearchFilters {
  numberQuery: string;
  runId: string | null;
  customerIds: string[];
  year: number | null;
  monthFrom: number | null;
  monthTo: number | null;
  excludeInternal: boolean;
}

export interface SearchResult {
  rows: BasisRow[];
  totalCount: number;
  truncated: boolean;
}

const SEARCH_LIMIT = 500;

export function useInvoiceSearch(entityId: string | null, filters: SearchFilters, execToken: number) {
  const settings = useInvoiceSettings(entityId);
  const internalKey = (settings.data?.internal_groups ?? []).slice().sort().join(",");
  return useQuery({
    queryKey: ["fakturering", "search", entityId, execToken, internalKey],
    enabled: execToken > 0 && !!entityId,
    queryFn: async (): Promise<SearchResult> => {
      let q = supabase
        .from("invoice_basis")
        .select(
          `*, customer:customer_id(id, display_name, customer_number, invoice_method, invoice_attachment, include_attachments_in_ehf), run:run_id(id, run_date, started_at)`,
          { count: "exact" },
        )
        .eq("legal_entity_id", entityId!)
        .order("basis_number", { ascending: false })
        .limit(SEARCH_LIMIT);

      if (filters.runId) q = q.eq("run_id", filters.runId);
      if (filters.customerIds.length > 0) q = q.in("customer_id", filters.customerIds);
      if (filters.excludeInternal) {
        const internal = settings.data?.internal_groups ?? [];
        if (internal.length > 0) q = q.not("invoicing_group", "in", `(${internal.map((g) => `"${g}"`).join(",")})`);
      }

      if (filters.year) {
        const y = filters.year;
        const mFrom = filters.monthFrom ?? 1;
        const mTo = filters.monthTo ?? 12;
        const start = `${y}-${String(mFrom).padStart(2, "0")}-01`;
        const endDate = new Date(y, mTo, 0);
        const end = `${y}-${String(mTo).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
        q = q.or(
          `and(tripletex_invoice_date.gte.${start},tripletex_invoice_date.lte.${end}),and(tripletex_invoice_date.is.null,created_at.gte.${start},created_at.lte.${end}T23:59:59)`,
        );
      }

      // Nummersøk:
      //  - «100-200» / «100..200» / «100 til 200» → range på basis_number KUN når BEGGE er rene tall
      //  - alt annet (inkludert «FG-2026») → prefix-søk på basis_number ELLER tripletex_invoice_number
      const nq = filters.numberQuery.trim();
      if (nq) {
        const rangeMatch = nq.match(/^\s*(\d+)\s*(?:-|\.\.|\s+til\s+)\s*(\d+)\s*$/i);
        if (rangeMatch) {
          q = q.gte("basis_number", rangeMatch[1]).lte("basis_number", rangeMatch[2]);
        } else {
          const escaped = nq.replace(/[,%]/g, "");
          q = q.or(`basis_number.ilike.${escaped}%,tripletex_invoice_number.ilike.${escaped}%`);
        }
      }

      const { data, error, count } = await q;
      if (error) throw error;
      const rows = (await attachOrderCounts(data ?? [])) as BasisRow[];
      const totalCount = typeof count === "number" ? count : rows.length;
      return { rows, totalCount, truncated: totalCount > rows.length };
    },
  });
}

export function useEntityCustomersLite(entityId: string | null) {
  return useQuery({
    queryKey: ["fakturering", "customers-lite", entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, display_name, customer_number")
        .eq("legal_entity_id", entityId!)
        .eq("status", "active")
        .order("customer_number", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; display_name: string; customer_number: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });
}


// ---------------------------------------------------------------------------
// Settings mutations (Innstillinger-siden)
// ---------------------------------------------------------------------------

export interface FullInvoiceSettings {
  legal_entity_id: string;
  default_due_days: number;
  vat_account_map: Record<string, string>;
  non_transfer_groups: string[];
  internal_groups: string[];
  attach_vedlegg: boolean;
  tripletex_meta: Record<string, any>;
  updated_at: string;
}

export function useFullInvoiceSettings(entityId: string | null) {
  return useQuery({
    queryKey: ["fakturering", "settings-full", entityId],
    enabled: !!entityId,
    queryFn: async (): Promise<FullInvoiceSettings> => {
      const { data, error } = await supabase
        .from("invoice_settings")
        .select("*")
        .eq("legal_entity_id", entityId!)
        .maybeSingle();
      if (error) throw error;
      const row: any = data ?? {};
      return {
        legal_entity_id: row.legal_entity_id ?? entityId!,
        default_due_days: row.default_due_days ?? 14,
        vat_account_map: row.vat_account_map ?? { "15": "3001", "25": "3000" },
        non_transfer_groups: row.non_transfer_groups ?? ["test"],
        internal_groups: row.internal_groups ?? ["internal_outlets"],
        attach_vedlegg: row.attach_vedlegg ?? true,
        tripletex_meta: row.tripletex_meta ?? {},
        updated_at: row.updated_at ?? new Date().toISOString(),
      };
    },
    staleTime: 30 * 1000,
  });
}

export interface SaveInvoiceSettingsInput {
  legal_entity_id: string;
  default_due_days: number;
  vat_account_map: Record<string, string>;
  non_transfer_groups: string[];
  internal_groups: string[];
  attach_vedlegg: boolean;
}

export async function saveInvoiceSettings(input: SaveInvoiceSettingsInput) {
  const { error } = await supabase
    .from("invoice_settings")
    .upsert(
      {
        legal_entity_id: input.legal_entity_id,
        default_due_days: input.default_due_days,
        vat_account_map: input.vat_account_map,
        non_transfer_groups: input.non_transfer_groups,
        internal_groups: input.internal_groups,
        attach_vedlegg: input.attach_vedlegg,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "legal_entity_id" },
    );
  if (error) throw error;
}

export async function clearTripletexMetaCache(entityId: string) {
  const { error } = await (supabase.rpc as any)("clear_invoice_tripletex_meta", {
    p_legal_entity_id: entityId,
  });
  if (error) throw error;
}
