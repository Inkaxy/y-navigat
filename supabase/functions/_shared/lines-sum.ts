// Sumkontroll for fakturalinjer — delt mellom den manuelle PDF-importen (frontend)
// og Tripletex-importen (edge function), slik at de to veiene ikke går fra hverandre.
// Filen må holdes fri for Deno- og nettleser-spesifikke API-er.

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
 * Kreditnota: total og linjer kan være lagret med motsatt fortegn (total positiv, linjer negative).
 * Da sammenlignes beløpene med linjenes fortegn. Gjelder BARE kreditnota; på en vanlig faktura er motsatt
 * fortegn et reelt avvik. Størrelsen sammenlignes fortsatt med samme toleranse.
 */
export function creditAlignedExpected(expected: number, linesSum: number, isCredit: boolean): number {
  if (!isCredit || expected === 0 || linesSum === 0) return expected;
  return Math.sign(expected) !== Math.sign(linesSum) ? -expected : expected;
}

/**
 * Sammenlign summen av varelinjene (eks. mva) mot fakturaens totalbeløp.
 * Fakturaens total_amount er inkl. mva, så vi trekker fra total_vat når den finnes.
 * `isCredit` (kreditnota) tillater motsatt fortegn mellom total og linjer, se creditAlignedExpected.
 */
export function computeLinesSum(input: {
  lineTotals: Array<number | null | undefined>;
  totalAmount: number | null | undefined;
  totalVat: number | null | undefined;
  isCredit?: boolean;
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
  const isCredit = input.isCredit === true;
  // Kreditnota: mva følger totalens fortegn (total -3612 med mva lagret som 471). Vanlig faktura: som før.
  const vat = !vatKnown ? 0 : isCredit ? Math.sign(total) * Math.abs(Number(totalVat)) : Number(totalVat);
  const expected = creditAlignedExpected(total - vat, rounded, isCredit);
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

/** Grensen for når en uthenting regnes som usikker og fakturaen må gjennomgås. */
export const EXTRACTION_CONFIDENCE_THRESHOLD = 0.7;

/** Er sikkerhetstallet fra uthentingen så lavt at fakturaen må gjennomgås manuelt? */
export function needsReviewFromConfidence(confidence: number | null | undefined): boolean {
  if (confidence == null) return false;
  const c = Number(confidence);
  if (!Number.isFinite(c)) return false;
  return c < EXTRACTION_CONFIDENCE_THRESHOLD;
}
