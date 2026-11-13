import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_NO_LINES_SINCE, NO_LINES_ERROR, type BulkGroup, type UsageCostRow } from "@/fakturaer/lib/bulkReread";

export interface BulkInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  supplier_name: string | null;
  total_amount: number | null;
  lines_sum_variance_pct: number | null;
}

const MAX_ROWS = 500;
const COLS = "id, invoice_number, invoice_date, total_amount, lines_sum_variance_pct, suppliers(name)";

type Row = { id: string; invoice_number: string | null; invoice_date: string | null; total_amount: number | null; lines_sum_variance_pct: number | null; suppliers: { name: string | null } | null };
const toBulk = (r: Row): BulkInvoice => ({ id: r.id, invoice_number: r.invoice_number, invoice_date: r.invoice_date, total_amount: r.total_amount, lines_sum_variance_pct: r.lines_sum_variance_pct, supplier_name: r.suppliers?.name ?? null });

/**
 * Fakturaene i hver gruppe for frosset selskap. Komplett eller feil: flere enn MAX_ROWS gir feil, aldri avkortet liste.
 * Gruppe 3 krever lagrede linjer (antall hentes per faktura i samme spørring).
 */
export function useBulkRereadGroups(legalEntityId: string | null, since = DEFAULT_NO_LINES_SINCE) {
  return useQuery({
    queryKey: ["bulk-reread-groups", legalEntityId, since],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<Record<BulkGroup, BulkInvoice[]>> => {
      const le = legalEntityId!;
      const [g1, g2, g3] = await Promise.all([
        supabase.from("invoices").select(COLS, { count: "exact" })
          .eq("legal_entity_id", le).not("tripletex_supplier_invoice_id", "is", null)
          .eq("line_extraction_status", "done").eq("lines_sum_status", "no_lines")
          .eq("line_extraction_error", NO_LINES_ERROR).gte("invoice_date", since)
          .order("invoice_date", { ascending: true }).order("id").limit(MAX_ROWS),
        supabase.from("invoices").select(COLS, { count: "exact" })
          .eq("legal_entity_id", le).not("tripletex_supplier_invoice_id", "is", null)
          .eq("line_extraction_status", "done").eq("lines_sum_status", "mismatch").eq("line_extraction_attempts", 0)
          .not("source_document_url", "is", null)
          .order("invoice_date", { ascending: true }).order("id").limit(MAX_ROWS),
        supabase.from("invoices").select(`${COLS}, invoice_lines(count)`, { count: "exact" })
          .eq("legal_entity_id", le).eq("lines_sum_status", "not_checked")
          .order("invoice_date", { ascending: true }).order("id").limit(MAX_ROWS),
      ]);
      for (const r of [g1, g2, g3]) {
        if (r.error) throw new Error("Fakturaene kunne ikke hentes. Prøv igjen.");
        if ((r.count ?? 0) > (r.data?.length ?? 0)) throw new Error(`Gruppen har flere enn ${MAX_ROWS} fakturaer. Kontakt administrator før bolkkjøring.`);
      }
      const withLines = ((g3.data ?? []) as unknown as (Row & { invoice_lines: { count: number }[] })[])
        .filter((r) => (r.invoice_lines?.[0]?.count ?? 0) > 0);
      return {
        uten_linjer: ((g1.data ?? []) as unknown as Row[]).map(toBulk),
        gamle_avvik: ((g2.data ?? []) as unknown as Row[]).map(toBulk),
        ikke_kontrollert: withLines.map(toBulk),
      };
    },
  });
}

/** Loggført kostnad per lesing (bare plattformadministrator kan lese loggen; ellers null = ukjent). */
export function useExtractionCostRows(enabled = true) {
  return useQuery({
    queryKey: ["extraction-cost-rows"],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<UsageCostRow[] | null> => {
      const { data, error } = await supabase.from("ai_usage_log").select("invoice_id, estimated_cost_usd, success")
        .eq("purpose", "invoice_extraction").eq("success", true).not("invoice_id", "is", null)
        .order("created_at", { ascending: false }).limit(300);
      if (error) return null;
      return (data ?? []).length === 0 ? null : (data as UsageCostRow[]);
    },
  });
}
