import { supabase } from "@/integrations/supabase/client";

export type LinesSumStatus = "not_checked" | "ok" | "mismatch" | "no_lines" | "no_total";

export interface LinesSumCheck {
  lines_sum_excl_vat: number | null;
  lines_sum_variance_pct: number | null;
  lines_sum_status: LinesSumStatus;
}

/** Toleranse når vi kan sammenligne mot eks. mva (total_vat kjent). */
export const LINES_SUM_TOLERANCE_PCT = 2;
/** Slingringsmonn når total_vat mangler og vi må sammenligne mot inkl. mva. */
export const LINES_SUM_TOLERANCE_PCT_NO_VAT = 20;

/**
 * Sammenlign summen av varelinjene (eks. mva) mot fakturaens totalbeløp.
 * Fakturaens total_amount er inkl. mva, så vi trekker fra total_vat når den finnes.
 */
export function computeLinesSum(input: {
  lineTotals: Array<number | null | undefined>;
  totalAmount: number | null | undefined;
  totalVat: number | null | undefined;
}): LinesSumCheck {
  const { lineTotals, totalAmount, totalVat } = input;

  if (!lineTotals || lineTotals.length === 0) {
    return { lines_sum_excl_vat: null, lines_sum_variance_pct: null, lines_sum_status: "no_lines" };
  }

  const sum = lineTotals.reduce<number>((s, v) => s + (Number(v) || 0), 0);
  const rounded = Number(sum.toFixed(2));

  const total = totalAmount == null ? null : Number(totalAmount);
  if (total == null || !Number.isFinite(total) || total === 0) {
    return { lines_sum_excl_vat: rounded, lines_sum_variance_pct: null, lines_sum_status: "no_total" };
  }

  const vatKnown = totalVat != null && Number.isFinite(Number(totalVat));
  const expected = vatKnown ? total - Number(totalVat) : total;
  const tolerance = vatKnown ? LINES_SUM_TOLERANCE_PCT : LINES_SUM_TOLERANCE_PCT_NO_VAT;

  if (expected === 0) {
    return { lines_sum_excl_vat: rounded, lines_sum_variance_pct: null, lines_sum_status: "no_total" };
  }

  const variance = ((rounded - expected) / expected) * 100;
  return {
    lines_sum_excl_vat: rounded,
    lines_sum_variance_pct: Number(variance.toFixed(3)),
    lines_sum_status: Math.abs(variance) <= tolerance ? "ok" : "mismatch",
  };
}

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
