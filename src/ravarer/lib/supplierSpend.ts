/**
 * Felles innkjøpsgrunnlag for leverandør (teller) og selskap (nevner): samme frosne periode,
 * samme statuspopulasjon, samme valutaregel. Lagret konvensjon: beløp positive, kreditnota
 * trekkes fra (net = total_amount − total_vat). Manglende mva er ukjent, aldri 0.
 */
export interface SpendSourceRow {
  id: string;
  status: string | null;
  currency: string | null;
  total_amount: number | null;
  total_vat: number | null;
  is_credit_note: boolean | null;
}

export interface SupplierSpendSummary {
  /** Netto NOK eks. mva — null når grunnlaget er ufullstendig. */
  netNok: number | null;
  /** Sum av NOK-fakturaer med kjent beløp og mva. */
  knownNetNokSubtotal: number;
  eligibleInvoiceCount: number;
  missingAmountCount: number;
  missingVatCount: number;
  invalidAmountCount: number;
  otherCurrencyCount: number;
  excludedCancelledCount: number;
  periodStart: string;
  periodEnd: string;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function summarizeSpend(rows: readonly SpendSourceRow[], periodStart: string, periodEnd: string): SupplierSpendSummary {
  const s: SupplierSpendSummary = {
    netNok: null, knownNetNokSubtotal: 0, eligibleInvoiceCount: 0, missingAmountCount: 0, missingVatCount: 0,
    invalidAmountCount: 0, otherCurrencyCount: 0, excludedCancelledCount: 0, periodStart, periodEnd,
  };
  for (const r of rows) {
    if (r.status === "cancelled") { s.excludedCancelledCount += 1; continue; }
    if ((r.currency ?? "").toUpperCase() !== "NOK") { s.otherCurrencyCount += 1; continue; }
    s.eligibleInvoiceCount += 1;
    const amt = r.total_amount === null ? null : Number(r.total_amount);
    const vat = r.total_vat === null ? null : Number(r.total_vat);
    if (amt === null) { s.missingAmountCount += 1; continue; }
    if (vat === null) { s.missingVatCount += 1; continue; }
    // Negative beløp passer ikke lagringskonvensjonen: ukjent, ikke omskrevet.
    if (!fin(amt) || !fin(vat) || amt < 0 || vat < 0) { s.invalidAmountCount += 1; continue; }
    const net = amt - vat;
    s.knownNetNokSubtotal += r.is_credit_note ? -net : net;
  }
  const complete = s.missingAmountCount === 0 && s.missingVatCount === 0 && s.invalidAmountCount === 0;
  s.netNok = complete ? s.knownNetNokSubtotal : null;
  return s;
}

/** Andel er tall bare når begge er komplette, samme periode, ren NOK og nevner > 0. */
export function spendShare(a: SupplierSpendSummary | undefined, b: SupplierSpendSummary | undefined): number | null {
  if (!a || !b || a.netNok == null || b.netNok == null) return null;
  if (a.periodStart !== b.periodStart || a.periodEnd !== b.periodEnd) return null;
  if (a.otherCurrencyCount > 0 || b.otherCurrencyCount > 0 || b.netNok <= 0) return null;
  return (a.netNok / b.netNok) * 100;
}
