/**
 * Typede kontrakter for råvare-RPC-ene. Flyttet ut av `pendingRpc.ts` nå som
 * funksjonene finnes i den genererte typefilen — kalles direkte via
 * `supabase.rpc(...)` uten casting.
 */

export interface ReconcileInvoiceResult {
  ok: boolean;
  already_reconciled: boolean;
  history_written: number;
  is_credit_note: boolean;
}

export interface CountLinePayload {
  raw_material_id: string;
  counted_base: number;
  /** Beholdningen klienten så da telleren skrev tallet — brukes til konfliktkontroll. RPC-en avviser null. */
  expected_base: number;
  line_note?: string | null;
}

export interface CountResultRow {
  raw_material_id: string;
  name?: string | null;
  before?: number | null;
  counted?: number | null;
  diff?: number | null;
}

export interface CountApplyResult {
  ok: boolean;
  adjusted: number;
  unchanged: number;
  rows: CountResultRow[];
  op_id?: string;
  already_applied?: boolean;
}

export interface ReceiveLineResult {
  ok: boolean;
  /** Sant når linja allerede er fysisk kvittert ut tidligere. */
  already_received?: boolean;
  quantity_base?: number;
  lot_id?: string | null;
  movement_id?: string | null;
  skipped?: string;
}

export interface ApplyAgreementResult {
  ok: boolean;
  link_id?: string;
  agreed_price?: number | null;
  agreed_price_per_base_unit?: number | null;
  is_primary?: boolean;
}

export interface AgreementPayload {
  raw_material_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  agreed_price: number | null;
  agreed_price_per_base_unit: number | null;
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  agreement_valid_from: string | null;
  agreement_valid_to: string | null;
  agreement_priority: number | null;
  agreement_document_url: string | null;
  is_primary: boolean;
}
