import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assessInboxInvoice, type InboxAssessment, type InboxLine } from "@/fakturaer/lib/inbox";

export interface InboxInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  legal_entity_id: string;
  supplier_id: string;
  supplier_name: string | null;
  is_credit_note: boolean | null;
  total_amount: number | null;
  total_vat: number | null;
  lines_sum_status: string | null;
  lines_sum_variance_pct: number | null;
  source_document_url: string | null;
  line_extraction_status: string | null;
  line_count: number;
  assessment: InboxAssessment;
}

interface Filters {
  legalEntityId?: string | null;
  supplierId?: string | null;
  /** «klar» viser bare fakturaer som står klare for prismatch. */
  onlyReady?: boolean;
}

interface RawInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  legal_entity_id: string;
  supplier_id: string;
  is_credit_note: boolean | null;
  total_amount: number | null;
  total_vat: number | null;
  lines_sum_status: string | null;
  lines_sum_variance_pct: number | null;
  source_document_url: string | null;
  line_extraction_status: string | null;
  suppliers: { name: string } | null;
  invoice_lines:
    | Array<{
        raw_material_id: string | null;
        requires_review: boolean | null;
        price_variance_pct: number | null;
        variance_status: string | null;
        raw_materials: { category: string | null } | null;
      }>
    | null;
}

/** Fakturaer som fortsatt er i arbeid — kortene øverst i innboksen. */
export function useInboxInvoices(
  filters: Filters,
  toleranceFor: (category?: string | null) => number,
) {
  return useQuery({
    queryKey: ["fakturaer-inbox", filters],
    refetchInterval: 30000,
    queryFn: async (): Promise<InboxInvoice[]> => {
      let q = supabase
        .from("invoices")
        .select(
          `id, invoice_number, invoice_date, status, legal_entity_id, supplier_id, is_credit_note,
           total_amount, total_vat, lines_sum_status, lines_sum_variance_pct, source_document_url,
           line_extraction_status, suppliers(name),
           invoice_lines(raw_material_id, requires_review, price_variance_pct, variance_status, raw_materials(category))`,
        )
        .in("status", filters.onlyReady ? ["ready"] : ["imported", "needs_review", "ready", "flagged"])
        .order("invoice_date", { ascending: false })
        .limit(100);

      if (filters.legalEntityId) q = q.eq("legal_entity_id", filters.legalEntityId);
      if (filters.supplierId) q = q.eq("supplier_id", filters.supplierId);

      const { data, error } = await q;
      if (error) throw error;

      return ((data ?? []) as unknown as RawInvoice[]).map((r) => {
        const lines: InboxLine[] = (r.invoice_lines ?? []).map((l) => ({
          raw_material_id: l.raw_material_id,
          requires_review: l.requires_review,
          price_variance_pct: l.price_variance_pct == null ? null : Number(l.price_variance_pct),
          variance_status: l.variance_status,
          category: l.raw_materials?.category ?? null,
        }));
        return {
          id: r.id,
          invoice_number: r.invoice_number,
          invoice_date: r.invoice_date,
          status: r.status,
          legal_entity_id: r.legal_entity_id,
          supplier_id: r.supplier_id,
          supplier_name: r.suppliers?.name ?? null,
          is_credit_note: r.is_credit_note,
          total_amount: r.total_amount,
          total_vat: r.total_vat,
          lines_sum_status: r.lines_sum_status,
          lines_sum_variance_pct: r.lines_sum_variance_pct,
          source_document_url: r.source_document_url,
          line_extraction_status: r.line_extraction_status,
          line_count: lines.length,
          assessment: assessInboxInvoice(
            {
              status: r.status,
              is_credit_note: r.is_credit_note,
              lines_sum_status: r.lines_sum_status,
              lines,
            },
            toleranceFor,
          ),
        };
      });
    },
  });
}
