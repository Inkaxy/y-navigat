import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReviewReason =
  | "unmatched"
  | "low_confidence"
  | "price_variance"
  | "sku_collision"
  | "unknown_package_size"
  | "price_increase"
  | "no_baseline";

export interface ReviewLineRow {
  id: string;
  invoice_id: string;
  line_number: number | null;
  supplier_sku: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  base_quantity: number | null;
  match_confidence: string | null;
  raw_material_id: string | null;
  price_per_base_unit: number | null;
  expected_price_per_base_unit: number | null;
  price_variance_pct: number | null;
  variance_status: string | null;
  review_reason: string | null;
  requires_review: boolean | null;
  invoice: {
    id: string;
    invoice_number: string;
    invoice_date: string;
    legal_entity_id: string;
    supplier_id: string;
    status: string | null;
    source: string | null;
    source_document_url: string | null;
    total_amount: number | null;
    total_vat: number | null;
    lines_sum_status: string | null;
    lines_sum_excl_vat: number | null;
    lines_sum_variance_pct: number | null;
    extraction_confidence: number | null;
    supplier: { name: string; contact_email: string | null } | null;
    legal_entity: { legal_name: string; short_code: string | null } | null;
  };

  suggestions: Array<{
    raw_material_id: string;
    confidence: number;
    match_reason: string | null;
    rank: number;
    raw_material: { name: string; sku: string | null; category: string | null; current_cost_price: number | null; base_unit?: string | null; item_type?: string | null } | null;
  }>;
  matched_raw_material?: { name: string; sku: string | null; category: string | null; item_type?: string | null } | null;
}

/** Fakturastatuser som ikke skal kunne behandles fra køen. */
export const HIDDEN_INVOICE_STATUSES = ["flagged", "reconciled"];

interface Filters {
  legalEntityId?: string | null;
  supplierId?: string | null;
}

export function useReviewLines(filters: Filters) {
  return useQuery({
    queryKey: ["fakturaer-review-lines", filters],
    queryFn: async () => {
      let q = supabase
        .from("invoice_lines")
        .select(
          `id, invoice_id, line_number, supplier_sku, description, quantity, unit, unit_price, total_amount,
           package_size, package_unit, count_per_package, base_quantity,
           match_confidence, raw_material_id, price_per_base_unit, expected_price_per_base_unit, price_variance_pct,
           variance_status, review_reason, requires_review,
           invoice:invoices!inner(id, invoice_number, invoice_date, legal_entity_id, supplier_id, status, source, source_document_url,
             total_amount, total_vat, lines_sum_status, lines_sum_excl_vat, lines_sum_variance_pct, extraction_confidence,
             supplier:suppliers(name, contact_email),
             legal_entity:legal_entities(legal_name, short_code)),
           suggestions:invoice_line_match_suggestions(raw_material_id, confidence, match_reason, rank,
             raw_material:raw_materials(name, sku, category, current_cost_price, base_unit, item_type)),
           matched_raw_material:raw_materials!invoice_lines_raw_material_id_fkey(name, sku, category, item_type)`,

          { count: "exact" },
        )
        // Ta også med matchede linjer uten avtalepris — de utgjør arbeidslisten
        // «Uten avtalepris», selv om de ikke er merket for gjennomgang.
        .or("requires_review.eq.true,variance_status.eq.no_baseline")
        .order("invoice_id")
        .limit(500);

      if (filters.legalEntityId) q = q.eq("invoice.legal_entity_id", filters.legalEntityId);
      if (filters.supplierId) q = q.eq("invoice.supplier_id", filters.supplierId);
      const { data, error, count } = await q;
      if (error) throw error;
      const all = (data ?? []) as any[];
      // Sort suggestions by rank
      all.forEach((r) => r.suggestions?.sort((a: any, b: any) => a.rank - b.rank));
      // Flaggede og avstemte fakturaer hører ikke hjemme i køen: å «løse» en
      // linje der ville kjørt match på nytt og satt fakturaen tilbake til ready.
      const rows = all.filter((r) => !HIDDEN_INVOICE_STATUSES.includes(r.invoice?.status ?? ""));
      const hiddenCount = all.length - rows.length;
      return { rows: rows as ReviewLineRow[], totalCount: count ?? all.length, hiddenCount };
    },
    refetchInterval: 30000,
  });
}
