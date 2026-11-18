// Raske lesefunksjoner (20261124_raske_oppslag_del1): rm_nav_counts, rm_price_jump_lines, rm_unread_invoices.
// Strenge parsere: et svar som ikke har nøyaktig forventet form kastes (vises som feil), aldri tom liste eller 0.
import type { JumpLineInput } from "@/ravarer/lib/fraFaktura/priceJumps";
import type { UnreadInput } from "@/ravarer/lib/fraFaktura/unread";

export interface NavCounts { datasheet_changes: number; agreements_expiring_30d: number; stock_below_min: number }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, f: string): string => { if (typeof v !== "string" || !v) throw new Error(`Uleselig svar (${f}).`); return v; };
const strN = (v: unknown, f: string): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new Error(`Uleselig svar (${f}).`);
};
const numN = (v: unknown, f: string): number | null => {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  throw new Error(`Uleselig svar (${f}).`);
};
const count = (v: unknown, f: string): number => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  throw new Error(`Uleselig svar (${f}).`);
};
const boolN = (v: unknown, f: string): boolean | null => { if (v == null) return null; if (typeof v === "boolean") return v; throw new Error(`Uleselig svar (${f}).`); };

function rowsOf(data: unknown, what: string): Record<string, unknown>[] {
  if (!isObj(data) || data.ok !== true || !Array.isArray(data.rows)) throw new Error(`Uleselig svar fra ${what}.`);
  return data.rows.map((r) => { if (!isObj(r)) throw new Error(`Uleselig rad fra ${what}.`); return r; });
}

export function parseNavCounts(data: unknown): NavCounts {
  if (!isObj(data) || data.ok !== true) throw new Error("Uleselig svar fra menytellerne.");
  return {
    datasheet_changes: count(data.datasheet_changes, "datasheet_changes"),
    agreements_expiring_30d: count(data.agreements_expiring_30d, "agreements_expiring_30d"),
    stock_below_min: count(data.stock_below_min, "stock_below_min"),
  };
}

export function parsePriceJumpRows(data: unknown): JumpLineInput[] {
  return rowsOf(data, "Prishopp").map((r) => ({
    id: str(r.id, "id"), invoice_id: str(r.invoice_id, "invoice_id"), raw_material_id: strN(r.raw_material_id, "raw_material_id"),
    supplier_sku: strN(r.supplier_sku, "supplier_sku"), description: strN(r.description, "description"),
    price_per_base_unit: numN(r.price_per_base_unit, "price_per_base_unit"),
    expected_price_per_base_unit: numN(r.expected_price_per_base_unit, "expected_price_per_base_unit"),
    price_variance_pct: numN(r.price_variance_pct, "price_variance_pct"), review_reason: strN(r.review_reason, "review_reason"),
    invoice_number: strN(r.invoice_number, "invoice_number"), invoice_date: strN(r.invoice_date, "invoice_date"), supplier_id: strN(r.supplier_id, "supplier_id"),
    rm_name: strN(r.rm_name, "rm_name"), rm_base_unit: strN(r.rm_base_unit, "rm_base_unit"), rm_item_type: strN(r.rm_item_type, "rm_item_type"),
  }));
}

export function parseUnreadRows(data: unknown): UnreadInput[] {
  return rowsOf(data, "Ikke lest").map((r) => ({
    id: str(r.id, "id"), invoice_number: strN(r.invoice_number, "invoice_number"), invoice_date: strN(r.invoice_date, "invoice_date"),
    supplier_id: strN(r.supplier_id, "supplier_id"), total_amount: numN(r.total_amount, "total_amount"), total_vat: numN(r.total_vat, "total_vat"),
    is_credit_note: boolN(r.is_credit_note, "is_credit_note"), lines_sum_excl_vat: numN(r.lines_sum_excl_vat, "lines_sum_excl_vat"),
    updated_at: strN(r.updated_at, "updated_at"), line_extraction_status: strN(r.line_extraction_status, "line_extraction_status"),
    line_extraction_error: strN(r.line_extraction_error, "line_extraction_error"), lines_sum_status: strN(r.lines_sum_status, "lines_sum_status"),
    tripletex_supplier_invoice_id: strN(r.tripletex_supplier_invoice_id, "tripletex_supplier_invoice_id"),
    line_count: count(r.line_count, "line_count"),
  }));
}
