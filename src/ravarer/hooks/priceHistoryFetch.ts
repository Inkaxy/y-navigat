/**
 * Prishistorikk med historisk grunnlag. Tabellen har ingen FK til invoices eller
 * invoice_lines, så metadata hentes i bolker (RLS gjelder) og knyttes på klienten.
 * Feil kastes alltid — en feil skal aldri se ut som tom historikk.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import {
  parseCorrection,
  resolveProvenance,
  type CorrectionSnapshot,
  type PriceProvenance,
} from "@/ravarer/lib/priceProvenance";

export interface PriceHistoryDbRow {
  id: string;
  raw_material_id: string;
  supplier_id: string | null;
  price: number;
  effective_date: string;
  source: string;
  source_reference: string | null;
  invoice_id: string | null;
  invoice_line_id: string | null;
  invoice_line_ref: string | null;
  notes: string | null;
  created_at: string;
  superseded_at: string | null;
  superseded_reason: string | null;
  is_legacy: boolean | null;
  is_credit: boolean | null;
  currency: string | null;
  snapshot_unit: string | null;
  snapshot_package: unknown;
  snapshot_currency: string | null;
  snapshot_source: string | null;
  snapshot_at: string | null;
}

export interface PriceHistoryFetched extends PriceHistoryDbRow {
  invoices: { invoice_number: string | null; is_credit_note: boolean | null } | null;
  provenance: PriceProvenance;
}

const CHUNK = 200;

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

export async function fetchPriceHistory(rawMaterialId: string): Promise<PriceHistoryFetched[]> {
  const rows = await fetchAllRows<PriceHistoryDbRow>((from, to) =>
    supabase
      .from("raw_material_price_history")
      .select("id, raw_material_id, supplier_id, price, effective_date, source, source_reference, invoice_id, invoice_line_id, invoice_line_ref, notes, created_at, superseded_at, superseded_reason, is_legacy, is_credit, currency, snapshot_unit, snapshot_package, snapshot_currency, snapshot_source, snapshot_at")
      .eq("raw_material_id", rawMaterialId)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to));

  const invoiceIds = [...new Set(rows.map((r) => r.invoice_id).filter((x): x is string => !!x))];
  const lineIds = [...new Set(rows.map((r) => r.invoice_line_id ?? r.invoice_line_ref).filter((x): x is string => !!x))];

  const inv = new Map<string, { invoice_number: string | null; is_credit_note: boolean | null }>();
  for (const ids of chunks(invoiceIds)) {
    const { data, error } = await supabase.from("invoices").select("id, invoice_number, is_credit_note").in("id", ids);
    if (error) throw error;
    for (const d of data ?? []) inv.set(d.id, { invoice_number: d.invoice_number, is_credit_note: d.is_credit_note });
  }

  const corrections = new Map<string, CorrectionSnapshot[]>();
  for (const ids of chunks(lineIds)) {
    // Dagens fakturalinje leses bevisst IKKE: den kan være rettet etter at prisen ble registrert.
    const c = await supabase.from("invoice_line_corrections").select("id, invoice_line_id, corrected_at, reason, changed_fields, original, corrected").in("invoice_line_id", ids);
    if (c.error) throw c.error;
    for (const d of c.data ?? []) {
      if (!d.invoice_line_id || !d.corrected_at) continue;
      const list = corrections.get(d.invoice_line_id) ?? [];
      list.push(parseCorrection(d));
      corrections.set(d.invoice_line_id, list);
    }
  }

  return rows.map((r) => {
    const lineId = r.invoice_line_id ?? r.invoice_line_ref;
    const i = r.invoice_id ? inv.get(r.invoice_id) ?? null : null;
    return {
      ...r,
      invoices: i ? { invoice_number: i.invoice_number, is_credit_note: i.is_credit_note } : null,
      provenance: resolveProvenance({
        snapshotUnit: r.snapshot_unit,
        snapshotPackage: r.snapshot_package,
        snapshotCurrency: r.snapshot_currency,
        snapshotSource: r.snapshot_source,
        snapshotAt: r.snapshot_at,
        currency: r.currency,
        corrections: lineId ? corrections.get(lineId) ?? [] : [],
      }),
    };
  });
}
