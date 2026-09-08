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
  already_posted?: boolean;
  quantity_base?: number;
  skipped?: string;
}

/** F5: idempotent varemottak per fakturalinje. */
export function rpcReceiveInvoiceLine(lineId: string): Promise<ReceiveLineResult> {
  return callPendingRpc<ReceiveLineResult>("rm_receive_invoice_line", { p_line_id: lineId });
}
