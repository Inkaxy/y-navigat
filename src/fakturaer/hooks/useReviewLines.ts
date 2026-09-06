import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";

export type ReviewReason =
  | "unmatched"
  | "low_confidence"
  | "price_variance"
  | "sku_collision"
  | "unknown_package_size"
  | "price_increase"
  | "price_drop"
  | "uncertain_cost"
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

const SELECT = `id, invoice_id, line_number, supplier_sku, description, quantity, unit, unit_price, total_amount,
   package_size, package_unit, count_per_package, base_quantity,
   match_confidence, raw_material_id, price_per_base_unit, expected_price_per_base_unit, price_variance_pct,
   variance_status, review_reason, requires_review,
   invoice:invoices!inner(id, invoice_number, invoice_date, legal_entity_id, supplier_id, status, source, source_document_url,
     total_amount, total_vat, lines_sum_status, lines_sum_excl_vat, lines_sum_variance_pct, extraction_confidence,
     supplier:suppliers(name, contact_email),
     legal_entity:legal_entities(legal_name, short_code)),
   suggestions:invoice_line_match_suggestions(raw_material_id, confidence, match_reason, rank,
     raw_material:raw_materials(name, sku, category, current_cost_price, base_unit, item_type)),
   matched_raw_material:raw_materials!invoice_lines_raw_material_id_fkey(name, sku, category, item_type)`;

interface Filters {
  legalEntityId?: string | null;
  supplierId?: string | null;
  /** Begrens køen til én faktura — brukes når et fakturakort er ekspandert. */
  invoiceId?: string | null;
  /** Samme «klar for prismatch»-filter som fakturakortene bruker. */
  onlyReady?: boolean;
  /**
   * Tak på antall linjer i listen over alle fakturaer. Uten tak kan
   * spørringen dra inn titusenvis av rader. `null` henter alt.
   */
  limit?: number | null;
}

/**
 * Linjene i behandlingskøen.
 *
 * Flaggede og avstemte fakturaer filtreres bort i SPØRRINGEN (ikke i
 * klienten), slik at både tellingen og pagineringen stemmer. Hele resultatet
 * hentes med paginering — det gamle taket på 500 linjer skjulte arbeid.
 */
export function useReviewLines(filters: Filters) {
  return useQuery({
    queryKey: ["fakturaer-review-lines", filters],
    queryFn: async () => {
      const build = (from: number, to: number) => {
        let q = supabase
          .from("invoice_lines")
          .select(SELECT)
          // Ta også med matchede linjer uten avtalepris — de utgjør arbeidslisten
          // «Uten avtalepris», selv om de ikke er merket for gjennomgang.
          .or("requires_review.eq.true,variance_status.eq.no_baseline")
          .not("invoice.status", "in", `(${HIDDEN_INVOICE_STATUSES.join(",")})`)
          .order("invoice_id")
          .order("line_number", { nullsFirst: false })
          .range(from, to);

        if (filters.legalEntityId) q = q.eq("invoice.legal_entity_id", filters.legalEntityId);
        if (filters.supplierId) q = q.eq("invoice.supplier_id", filters.supplierId);
        if (filters.invoiceId) q = q.eq("invoice_id", filters.invoiceId);
        if (filters.onlyReady) q = q.eq("invoice.status", "ready");
        return q as unknown as PromiseLike<{ data: ReviewLineRow[] | null; error: { message: string } | null }>;
      };

      const limit = filters.limit ?? null;
      let rows: ReviewLineRow[];
      let hasMore = false;
      if (limit != null) {
        // Ett ekstra treff avslører om det finnes flere linjer enn taket.
        const { data, error } = await build(0, limit);
        if (error) throw new Error(error.message);
        rows = data ?? [];
        hasMore = rows.length > limit;
        if (hasMore) rows = rows.slice(0, limit);
      } else {
        rows = await fetchAllRows<ReviewLineRow>(build);
      }

      rows.forEach((r) => r.suggestions?.sort((a, b) => a.rank - b.rank));
      // Nyeste faktura først. Sorteringen gjøres i klienten fordi PostgREST
      // ikke kan sortere toppnivået på en kolonne fra den innbakte fakturaen.
      rows.sort((a, b) => {
        const d = (b.invoice?.invoice_date ?? "").localeCompare(a.invoice?.invoice_date ?? "");
        if (d !== 0) return d;
        if (a.invoice_id !== b.invoice_id) return a.invoice_id.localeCompare(b.invoice_id);
        return (a.line_number ?? 0) - (b.line_number ?? 0);
      });
      return { rows, totalCount: rows.length, hiddenCount: 0, hasMore };
    },
    refetchInterval: 30000,
  });
}

/** Det lille settet med felter som trengs for å telle køen per fane. */
export interface ReviewLineCountRow {
  id: string;
  invoice_id: string;
  review_reason: string | null;
  requires_review: boolean | null;
  variance_status: string | null;
  raw_material_id: string | null;
}

/**
 * Teller HELE køen — ikke bare de linjene som er hentet inn i tabellen.
 * Uten denne viste fanetellerne bare det avkortede settet.
 */
export function useReviewLineCounts(filters: Omit<Filters, "limit">) {
  return useQuery({
    queryKey: ["fakturaer-review-count", "lines", filters],
    queryFn: async () => {
      const build = (from: number, to: number) => {
        let q = supabase
          .from("invoice_lines")
          .select(
            "id, invoice_id, review_reason, requires_review, variance_status, raw_material_id, invoice:invoices!inner(id)",
          )
          .or("requires_review.eq.true,variance_status.eq.no_baseline")
          .not("invoice.status", "in", `(${HIDDEN_INVOICE_STATUSES.join(",")})`)
          .order("invoice_id")
          .range(from, to);
        if (filters.legalEntityId) q = q.eq("invoice.legal_entity_id", filters.legalEntityId);
        if (filters.supplierId) q = q.eq("invoice.supplier_id", filters.supplierId);
        if (filters.invoiceId) q = q.eq("invoice_id", filters.invoiceId);
        if (filters.onlyReady) q = q.eq("invoice.status", "ready");
        return q as unknown as PromiseLike<{ data: ReviewLineCountRow[] | null; error: { message: string } | null }>;
      };
      return await fetchAllRows<ReviewLineCountRow>(build);
    },
    refetchInterval: 30000,
  });
}

