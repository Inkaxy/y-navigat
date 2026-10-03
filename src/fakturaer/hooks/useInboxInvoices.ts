import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { assessInboxInvoice, inboxTabOf, type InboxAssessment, type InboxLine, type InboxTab } from "@/fakturaer/lib/inbox";

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
  source: string | null;
  notes: string | null;
  paid_at: string | null;
  tripletex_is_paid: boolean | null;
  line_extraction_attempts: number;
  line_count: number;
  assessment: InboxAssessment;
  tab: InboxTab;
}

interface Filters {
  legalEntityId?: string | null;
  supplierId?: string | null;
}

/** Alle statuser som fortsatt er i arbeid — «ready» hører med. */
export const OPEN_INVOICE_STATUSES = ["imported", "needs_review", "flagged", "ready"] as const;

const SELECT = `id, invoice_number, invoice_date, status, legal_entity_id, supplier_id, is_credit_note,
  total_amount, total_vat, lines_sum_status, lines_sum_variance_pct, source_document_url,
  line_extraction_status, line_extraction_attempts, source, notes, paid_at, tripletex_is_paid, currency, extraction_confidence, suppliers(name),
  invoice_lines(id, quantity, price_per_base_unit, raw_material_id, requires_review, review_reason, match_confidence, price_variance_pct, variance_status, raw_materials(category))`;

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
  source: string | null;
  notes: string | null;
  paid_at: string | null;
  tripletex_is_paid: boolean | null;
  line_extraction_attempts: number;
  currency?: string | null;
  extraction_confidence?: number | null;
  suppliers: { name: string } | null;
  invoice_lines: Array<{
    id?: string;
    quantity?: number | null;
    price_per_base_unit?: number | null;
    raw_material_id: string | null;
    requires_review: boolean | null;
    review_reason: string | null;
    match_confidence: string | null;
    price_variance_pct: number | null;
    variance_status: string | null;
    raw_materials: { category: string | null } | null;
  }> | null;
}

export function toInboxInvoice(r: RawInvoice): InboxInvoice {
  const lines: InboxLine[] = (r.invoice_lines ?? []).map((l) => ({
    raw_material_id: l.raw_material_id,
    requires_review: l.requires_review,
    review_reason: l.review_reason,
    match_confidence: l.match_confidence,
    price_variance_pct: l.price_variance_pct == null ? null : Number(l.price_variance_pct),
    variance_status: l.variance_status,
    category: l.raw_materials?.category ?? null,
    id: l.id,
    quantity: l.quantity == null ? null : Number(l.quantity),
    price_per_base_unit: l.price_per_base_unit == null ? null : Number(l.price_per_base_unit),
    invoice: { currency: r.currency ?? null, lines_sum_status: r.lines_sum_status, extraction_confidence: r.extraction_confidence ?? null },
  }));
  const assessment = assessInboxInvoice({
    status: r.status,
    is_credit_note: r.is_credit_note,
    lines_sum_status: r.lines_sum_status,
    notes: r.notes,
    line_extraction_status: r.line_extraction_status,
    lines,
  });
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
    source: r.source,
    notes: r.notes,
    paid_at: r.paid_at,
    tripletex_is_paid: r.tripletex_is_paid,
    line_extraction_attempts: r.line_extraction_attempts ?? 0,
    line_count: lines.length,
    assessment,
    tab: inboxTabOf({ status: r.status, assessment }),
  };
}

/**
 * ALLE fakturaer som fortsatt er i arbeid, side for side — ingen stille tak.
 * Fanene «Må avklares» og «Klar til å fullføre» deles på klienten etter
 * linjenes faktiske tilstand, så tallene i fanene er de ekte totalene.
 */
export function useInboxInvoices(filters: Filters) {
  return useQuery({
    queryKey: ["fakturaer-inbox", filters],
    refetchInterval: 30000,
    queryFn: async (): Promise<InboxInvoice[]> => {
      const rows = await fetchAllRows<RawInvoice>((from, to) => {
        let q = supabase
          .from("invoices")
          .select(SELECT)
          .in("status", [...OPEN_INVOICE_STATUSES])
          .order("invoice_date", { ascending: false })
          .order("id")
          .range(from, to);
        if (filters.legalEntityId) q = q.eq("legal_entity_id", filters.legalEntityId);
        if (filters.supplierId) q = q.eq("supplier_id", filters.supplierId);
        return q as unknown as PromiseLike<{ data: RawInvoice[] | null; error: { message: string } | null }>;
      }, 200);
      return rows.map(toInboxInvoice);
    },
  });
}

export const COMPLETED_PAGE_SIZE = 25;

/** Fullførte (avstemte) fakturaer — sideinndelt på serveren med eksakt total. */
export function useCompletedInvoices(filters: Filters & { search: string; page: number; enabled: boolean }) {
  return useQuery({
    queryKey: ["fakturaer-inbox-done", filters],
    enabled: filters.enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: InboxInvoice[]; total: number }> => {
      const term = filters.search.trim();
      let supplierIds: string[] | null = null;
      if (term) {
        const { data: sup, error: supErr } = await supabase
          .from("suppliers")
          .select("id")
          .ilike("name", `%${term}%`)
          .limit(50);
        if (supErr) throw supErr;
        supplierIds = (sup ?? []).map((s) => s.id);
      }
      const from = filters.page * COMPLETED_PAGE_SIZE;
      let q = supabase
        .from("invoices")
        .select(SELECT, { count: "exact" })
        .eq("status", "reconciled")
        .order("invoice_date", { ascending: false })
        .order("id")
        .range(from, from + COMPLETED_PAGE_SIZE - 1);
      if (filters.legalEntityId) q = q.eq("legal_entity_id", filters.legalEntityId);
      if (filters.supplierId) q = q.eq("supplier_id", filters.supplierId);
      if (term) {
        const safe = term.replace(/[,()%]/g, " ");
        const ors = [`invoice_number.ilike.%${safe}%`];
        if (supplierIds && supplierIds.length) ors.push(`supplier_id.in.(${supplierIds.join(",")})`);
        q = q.or(ors.join(","));
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: ((data ?? []) as unknown as RawInvoice[]).map(toInboxInvoice), total: count ?? 0 };
    },
  });
}

/** Klientfilter for åpne fakturaer: leverandørnavn eller fakturanummer. */
export function matchesInboxSearch(inv: Pick<InboxInvoice, "invoice_number" | "supplier_name">, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return inv.invoice_number.toLowerCase().includes(t) || (inv.supplier_name ?? "").toLowerCase().includes(t);
}
