/**
 * Nivådelt prisavvik — speiler `rm_price_deviation_eval` i databasen.
 * Et avvik er STORT når |%| > maksgrense, ELLER |%| > toleranse OG
 * kronevirkningen (avvik per grunnenhet × mengde) > minstebeløpet.
 * Uten kjent mengde teller bare prosenten.
 */
export type DeviationRule =
  | "innenfor_toleranse"
  | "liten_kronevirkning"
  | "over_toleranse"
  | "over_maksgrense"
  | "mangler_grunnlag";

export interface PriceDeviationInput {
  actual: number | null | undefined;
  expected: number | null | undefined;
  baseQuantity: number | null | undefined;
  tolPct: number;
  minImpactNok: number;
  hardCapPct: number;
}

export interface PriceDeviationResult {
  pct: number | null;
  impactNok: number | null;
  large: boolean;
  rule: DeviationRule;
  explanation: string;
}

const nbNum = (n: number, d = 1) => n.toLocaleString("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: d });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${nbNum(Math.abs(n))} %`;
const kr = (n: number) => `${nbNum(Math.round(Math.abs(n)), 0)} kr`;
const fin = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

export function evaluatePriceDeviation(i: PriceDeviationInput): PriceDeviationResult {
  if (!fin(i.actual) || !fin(i.expected) || i.expected <= 0) {
    return { pct: null, impactNok: null, large: false, rule: "mangler_grunnlag", explanation: "Mangler prisgrunnlag — avviket kan ikke regnes ut." };
  }
  const pct = ((i.actual - i.expected) / i.expected) * 100;
  const qty = fin(i.baseQuantity) && i.baseQuantity > 0 ? i.baseQuantity : null;
  const impactNok = qty == null ? null : (i.actual - i.expected) * qty;
  const abs = Math.abs(pct);
  const impactTxt = impactNok == null ? "" : ` (${kr(impactNok)} på denne linjen)`;

  if (abs > i.hardCapPct) {
    return { pct, impactNok, large: true, rule: "over_maksgrense", explanation: `${signed(pct)}${impactTxt} — over maksgrensen på ${nbNum(i.hardCapPct)} %` };
  }
  if (abs <= i.tolPct) {
    return { pct, impactNok, large: false, rule: "innenfor_toleranse", explanation: `${signed(pct)}${impactTxt} — innenfor toleransen på ${nbNum(i.tolPct)} %` };
  }
  if (impactNok == null || Math.abs(impactNok) > i.minImpactNok) {
    const tail = impactNok == null ? "" : ` og over minstebeløpet på ${kr(i.minImpactNok)}`;
    return { pct, impactNok, large: true, rule: "over_toleranse", explanation: `${signed(pct)}${impactTxt} — over toleransen på ${nbNum(i.tolPct)} %${tail}` };
  }
  return { pct, impactNok, large: false, rule: "liten_kronevirkning", explanation: `${signed(pct)}, men bare ${kr(impactNok)} på linjen — godtas automatisk` };
}
