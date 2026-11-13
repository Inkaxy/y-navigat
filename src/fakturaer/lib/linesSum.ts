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
  input: { lineTotals: Array<number | null | undefined>; totalAmount: number | null | undefined; totalVat: number | null | undefined; isCredit?: boolean },
): Promise<LinesSumCheck> {
  const check = computeLinesSum(input);
  const { error } = await supabase.from("invoices").update(check).eq("id", invoiceId);
  if (error) throw new Error("Sumkontrollen kunne ikke lagres. Prøv igjen.");
  return check;
}

/** Hent linjer + hode fra databasen og oppdater kontrollen. */
export async function recheckInvoiceLinesSum(invoiceId: string): Promise<LinesSumCheck | null> {
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("total_amount, total_vat, is_credit_note")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) throw new Error("Fakturaen kunne ikke leses. Prøv igjen.");
  if (!inv) return null;
  const { data: lines, error: linesErr } = await supabase
    .from("invoice_lines")
    .select("total_amount")
    .eq("invoice_id", invoiceId)
    .limit(1000);
  // Ukjent linjegrunnlag er ikke 0 linjer: da lagres ingenting.
  if (linesErr || !lines) throw new Error("Fakturalinjene kunne ikke leses. Prøv igjen.");
  return saveLinesSumCheck(invoiceId, {
    lineTotals: lines.map((l) => l.total_amount),
    totalAmount: inv.total_amount,
    totalVat: inv.total_vat,
    isCredit: inv.is_credit_note === true,
  });
}

export { formatSignedPct as formatVariancePct } from "./sumDirection";
