import { supabase } from "@/integrations/supabase/client";

// Sumkontrollen bor i supabase/functions/_shared/lines-sum.ts slik at både den
// manuelle PDF-importen og Tripletex-importen bruker nøyaktig samme regnestykke.
export {
  computeLinesSum,
  needsReviewFromConfidence,
  EXTRACTION_CONFIDENCE_THRESHOLD,
  LINES_SUM_TOLERANCE_PCT,
  LINES_SUM_TOLERANCE_PCT_NO_VAT,
} from "../../../supabase/functions/_shared/lines-sum.ts";
export type { LinesSumCheck, LinesSumStatus } from "../../../supabase/functions/_shared/lines-sum.ts";

import { computeLinesSum } from "../../../supabase/functions/_shared/lines-sum.ts";
import type { LinesSumCheck } from "../../../supabase/functions/_shared/lines-sum.ts";

/** Regn ut og lagre kontrollen på fakturaen. Returnerer resultatet. */
export async function saveLinesSumCheck(
  invoiceId: string,
  input: { lineTotals: Array<number | null | undefined>; totalAmount: number | null | undefined; totalVat: number | null | undefined },
): Promise<LinesSumCheck> {
  const check = computeLinesSum(input);
  await supabase.from("invoices").update(check).eq("id", invoiceId);
  return check;
}

/** Hent linjer + hode fra databasen og oppdater kontrollen. */
export async function recheckInvoiceLinesSum(invoiceId: string): Promise<LinesSumCheck | null> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("total_amount, total_vat")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return null;
  const { data: lines } = await supabase
    .from("invoice_lines")
    .select("total_amount")
    .eq("invoice_id", invoiceId);
  return saveLinesSumCheck(invoiceId, {
    lineTotals: (lines ?? []).map((l) => l.total_amount),
    totalAmount: inv.total_amount,
    totalVat: inv.total_vat,
  });
}

export function formatVariancePct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)} %`;
}
