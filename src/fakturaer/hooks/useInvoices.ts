import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface InvoiceListRow {
  id: string;
  legal_entity_id: string;
  supplier_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number | null;
  currency: string | null;
  status: string;
  source: string | null;
  imported_at: string;
  line_extraction_status: string | null;
  line_extraction_error: string | null;
  /** AI-ens lesesikkerhet ved PDF-import (0–1). */
  extraction_confidence: number | null;
  lines_sum_status: string | null;

  supplier?: { name: string } | null;
  legal_entity?: { legal_name: string; short_code: string | null } | null;
  line_count: number;
  review_count: number;
}

export interface InvoiceListResult {
  rows: InvoiceListRow[];
  totalCount: number;
}

export type InvoiceSortKey = "invoice_date" | "total_amount" | "supplier";
export type SortDir = "asc" | "desc";

export interface InvoiceFilters {
  legalEntityId?: string | null;
  status?: string | null;
  supplierId?: string | null;
  search?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  onlyMismatch?: boolean;
  sortKey?: InvoiceSortKey;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

const SELECT =
  "id, legal_entity_id, supplier_id, invoice_number, invoice_date, due_date, total_amount, currency, status, source, imported_at, line_extraction_status, line_extraction_error, extraction_confidence, lines_sum_status, suppliers!inner(name), legal_entities(legal_name, short_code), invoice_lines(id, requires_review)";

export function useInvoices(filters: InvoiceFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const sortKey = filters.sortKey ?? "invoice_date";
  const sortDir = filters.sortDir ?? "desc";

  return useQuery({
    queryKey: ["fakturaer", filters],
    queryFn: async (): Promise<InvoiceListResult> => {
      let q = supabase.from("invoices").select(SELECT, { count: "exact" });

      if (filters.legalEntityId) q = q.eq("legal_entity_id", filters.legalEntityId);
      if (filters.status) q = q.eq("status", filters.status);
      if (filters.supplierId) q = q.eq("supplier_id", filters.supplierId);
      if (filters.dateFrom) q = q.gte("invoice_date", filters.dateFrom);
      if (filters.dateTo) q = q.lte("invoice_date", filters.dateTo);
      if (filters.onlyMismatch) q = q.eq("lines_sum_status", "mismatch");

      const search = filters.search?.trim();
      if (search) {
        const escaped = search.replace(/[%,()]/g, " ").trim();
        if (escaped) {
          // Fakturanummer på fakturaen, eller leverandørnavn via inner-joinet leverandør.
          q = q.or(`invoice_number.ilike.%${escaped}%,suppliers.name.ilike.%${escaped}%`);
        }
      }

      if (sortKey === "supplier") {
        q = q.order("name", { referencedTable: "suppliers", ascending: sortDir === "asc" });
      } else {
        q = q.order(sortKey, { ascending: sortDir === "asc", nullsFirst: false });
      }
      q = q.order("invoice_number", { ascending: true });

      const from = (page - 1) * pageSize;
      q = q.range(from, from + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;

      type Raw = Omit<InvoiceListRow, "supplier" | "legal_entity" | "line_count" | "review_count"> & {
        suppliers: { name: string } | null;
        legal_entities: { legal_name: string; short_code: string | null } | null;
        invoice_lines: { id: string; requires_review: boolean | null }[] | null;
      };

      const rows = ((data ?? []) as unknown as Raw[]).map((r) => ({
        id: r.id,
        legal_entity_id: r.legal_entity_id,
        supplier_id: r.supplier_id,
        invoice_number: r.invoice_number,
        invoice_date: r.invoice_date,
        due_date: r.due_date,
        total_amount: r.total_amount,
        currency: r.currency,
        status: r.status,
        source: r.source,
        imported_at: r.imported_at,
        extraction_confidence: r.extraction_confidence,
        lines_sum_status: r.lines_sum_status,
        line_extraction_status: r.line_extraction_status ?? null,
        line_extraction_error: r.line_extraction_error ?? null,
        supplier: r.suppliers ? { name: r.suppliers.name } : null,
        legal_entity: r.legal_entities
          ? { legal_name: r.legal_entities.legal_name, short_code: r.legal_entities.short_code }
          : null,
        line_count: (r.invoice_lines ?? []).length,
        review_count: (r.invoice_lines ?? []).filter((l) => l.requires_review).length,
      })) as InvoiceListRow[];

      return { rows, totalCount: count ?? rows.length };
    },
  });
}

export interface InvoiceSupplierOption {
  id: string;
  name: string;
}

/** Leverandører som faktisk har fakturaer — til filtervelgeren. */
export function useInvoiceSuppliers(legalEntityId?: string | null) {
  return useQuery({
    queryKey: ["fakturaer-leverandorer", legalEntityId ?? "all"],
    queryFn: async (): Promise<InvoiceSupplierOption[]> => {
      let q = supabase.from("suppliers").select("id, name").order("name");
      if (legalEntityId) q = q.eq("legal_entity_id", legalEntityId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InvoiceSupplierOption[];
    },
  });
}
