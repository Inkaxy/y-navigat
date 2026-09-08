import { supabase } from "@/integrations/supabase/client";

/**
 * Kall til databasefunksjoner som er skrevet i denne runden, men som rulles ut
 * manuelt (se `supabase/migrations-pending/`). De finnes derfor ikke i den
 * genererte typefilen ennå, og trenger ett kontrollert unntak — samlet her, slik
 * at resten av koden slipper egne typecaster.
 *
 * Når migrasjonene er kjørt og `src/integrations/supabase/types.ts` er regenerert,
 * kan disse funksjonene byttes ut med direkte `supabase.rpc(...)`-kall.
 */
type RpcArgs = Record<string, unknown>;

async function callPendingRpc<T>(fn: string, args: RpcArgs): Promise<T> {
  const client = supabase as unknown as {
    rpc: (name: string, params: RpcArgs) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface ReconcileInvoiceResult {
  ok: boolean;
  already_reconciled: boolean;
  history_written: number;
  is_credit_note: boolean;
}

/** F2: atomisk avstemming av én faktura. */
export function rpcReconcileInvoice(invoiceId: string): Promise<ReconcileInvoiceResult> {
  return callPendingRpc<ReconcileInvoiceResult>("rm_reconcile_invoice", { p_invoice_id: invoiceId });
}

export interface CountLinePayload {
  raw_material_id: string;
  counted_base: number;
  /** Beholdningen klienten så da telleren skrev tallet — brukes til konfliktkontroll. */
  expected_base: number | null;
  line_note?: string | null;
}

export interface CountApplyResult {
  ok: boolean;
  adjusted: number;
  unchanged: number;
  rows: { raw_material_id: string; name?: string | null; before?: number | null; counted?: number | null; diff?: number | null }[];
  op_id?: string;
  already_applied?: boolean;
}

/** F5: idempotent telling med konfliktkontroll. */
export function rpcApplyStockCount(input: {
  opId: string;
  lines: CountLinePayload[];
  note: string;
}): Promise<CountApplyResult> {
  return callPendingRpc<CountApplyResult>("rm_stock_count_apply_v2", {
    p_op_id: input.opId,
    p_lines: input.lines,
    p_note: input.note,
  });
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

/**
 * F5: sporbart varemottak per fakturalinje.
 *
 * En bokført lagerbevegelse fra fakturatriggeren er ikke det samme som at varen
 * fysisk er mottatt. RPC-en kvitterer derfor ut mottaket med hvem, når og mengde,
 * og oppretter et parti (lot) med partinummer og holdbarhet når det er oppgitt.
 */
export function rpcReceiveInvoiceLine(input: {
  lineId: string;
  lotNumber?: string | null;
  bestBefore?: string | null;
  note?: string | null;
}): Promise<ReceiveLineResult> {
  return callPendingRpc<ReceiveLineResult>("rm_receive_invoice_line", {
    p_line_id: input.lineId,
    p_lot_number: input.lotNumber ?? null,
    p_best_before: input.bestBefore ?? null,
    p_note: input.note ?? null,
  });
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

/**
 * F4: lagrer en leverandøravtale i én transaksjon.
 *
 * Uten dette lagres avtalen i tre separate kall, og feiler ett av dem kan råvaren
 * stå igjen med to primærleverandører. RPC-en validerer også selskap, datoer og
 * priser, og fører avtalen som en prishendelse — ikke som ny kostpris.
 */
export function rpcApplyAgreement(payload: AgreementPayload): Promise<ApplyAgreementResult> {
  return callPendingRpc<ApplyAgreementResult>("rm_apply_agreement", { p_payload: payload });
}
