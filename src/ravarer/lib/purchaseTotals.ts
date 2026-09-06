export interface SpendInvoiceRow {
  total_amount: number | null;
  total_vat: number | null;
  is_credit_note: boolean | null;
}

/**
 * Sum kjøpt eks. mva. Kreditnotaer trekkes fra, slik at tallet svarer til
 * faktisk kjøp i perioden.
 */
export function supplierSpendExclVat(rows: readonly SpendInvoiceRow[]): number {
  return rows.reduce((sum, r) => {
    const net = Number(r.total_amount ?? 0) - Number(r.total_vat ?? 0);
    return sum + (r.is_credit_note ? -net : net);
  }, 0);
}
