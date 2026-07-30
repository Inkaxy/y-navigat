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
  supplier?: { name: string } | null;
  legal_entity?: { legal_name: string; short_code: string | null } | null;
  line_count: number;
  review_count: number;
}

export interface InvoiceListResult {
  rows: InvoiceListRow[];
  totalCount: number;
}

export function useInvoices(filters: { legalEntityId?: string | null; status?: string | null; supplierId?: string | null; search?: string }) {
  return useQuery({
    queryKey: ["fakturaer", filters],
    queryFn: async (): Promise<InvoiceListResult> => {
      let q = supabase
        .from("invoices")
        .select(
          "id, legal_entity_id, supplier_id, invoice_number, invoice_date, due_date, total_amount, currency, status, source, imported_at, suppliers(name), legal_entities(legal_name, short_code), invoice_lines(id, requires_review)",
          { count: "exact" },
        )
        .order("invoice_date", { ascending: false })
        .limit(500);

      if (filters.legalEntityId) q = q.eq("legal_entity_id", filters.legalEntityId);
      if (filters.status) q = q.eq("status", filters.status);
      if (filters.supplierId) q = q.eq("supplier_id", filters.supplierId);
      if (filters.search) q = q.ilike("invoice_number", `%${filters.search}%`);

      const { data, error, count } = await q;
      if (error) throw error;
      const rows = (data ?? []).map((r: any) => ({
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
        supplier: r.suppliers ? { name: r.suppliers.name } : null,
        legal_entity: r.legal_entities ? { legal_name: r.legal_entities.legal_name, short_code: r.legal_entities.short_code } : null,
        line_count: (r.invoice_lines ?? []).length,
        review_count: (r.invoice_lines ?? []).filter((l: any) => l.requires_review).length,
      })) as InvoiceListRow[];
      return { rows, totalCount: count ?? rows.length };
    },
  });
}
