import { kioskSupabase } from "@/kiosk/integrations/supabase/client";

export interface CashSummary {
  cash_sales: number;   // positiv sum av kontant-amounts på sale-transaksjoner
  cash_refunds: number; // positiv sum av kontant-refunds (return)
  cash_total: number;   // netto bevegelse (sales − refunds)
}

interface PaymentEntry {
  method?: string;
  amount?: number | string;
}

interface TxRow {
  transaction_type: string;
  is_training: boolean | null;
  payment_summary: { payments?: PaymentEntry[] } | null;
}

/**
 * Henter kontant-summer for sesjonen ved å lese pos_transactions og
 * summere payment_summary.payments[] med method='cash'.
 *
 * NB: payment_summary materialiserer fortegn allerede (returbetalinger
 * er negative), så vi summerer direkte. Dette speiler RPC-en
 * pos_close_session sin egen aritmetikk.
 */
export async function fetchSessionCashSummary(
  sessionId: string,
): Promise<CashSummary> {
  const { data, error } = await kioskSupabase
    .from("pos_transactions")
    .select("transaction_type, is_training, payment_summary")
    .eq("session_id", sessionId);
  if (error) throw error;

  let cash_total = 0;
  let cash_sales = 0;
  let cash_refunds = 0;

  for (const tx of (data ?? []) as TxRow[]) {
    if (tx.is_training) continue;
    const payments = tx.payment_summary?.payments ?? [];
    for (const p of payments) {
      if (p.method !== "cash") continue;
      const amount = Number(p.amount ?? 0);
      if (!Number.isFinite(amount)) continue;
      cash_total += amount;
      if (tx.transaction_type === "sale") cash_sales += amount;
      else if (tx.transaction_type === "return") cash_refunds += -amount;
    }
  }

  return {
    cash_sales: round2(cash_sales),
    cash_refunds: round2(cash_refunds),
    cash_total: round2(cash_total),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CloseInput {
  sessionId: string;
  closingFloat: number;
  countedCash: number;
}

export async function closeSession(input: CloseInput): Promise<void> {
  const { error } = await kioskSupabase.rpc("pos_close_session" as never, {
    p_session_id: input.sessionId,
    p_closing_float: input.closingFloat,
    p_counted_cash: input.countedCash,
  } as never);
  if (error) throw error;
}
