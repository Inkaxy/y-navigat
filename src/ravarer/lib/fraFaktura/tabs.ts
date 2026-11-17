// Demo D – faner og tellere på «Fra faktura». Ren logikk.
export const FRA_FAKTURA_TABS = ["nye", "prishopp", "ikke-lest"] as const;
export type FraFakturaTab = (typeof FRA_FAKTURA_TABS)[number];
export const parseFraFakturaTab = (v: string | null): FraFakturaTab => ((FRA_FAKTURA_TABS as readonly string[]).includes(v ?? "") ? (v as FraFakturaTab) : "nye");

/** Menyens teller = sum av de tre fanene. Ukjent i én fane = ukjent sum (aldri en for lav teller). */
export function fraFakturaTotal(parts: readonly (number | null)[]): number | null {
  let s = 0;
  for (const p of parts) { if (p == null) return null; s += p; }
  return s;
}

/**
 * «Øvrige spørsmål»: åpne spørsmål i Beslutninger som «Fra faktura» ikke viser (kontroll, små prisendringer …).
 * Null = ukjent.
 */
export function otherQuestions(o: { open: number | null; newItems: number | null; coveredPrices: number | null; unreadInvoiceItems: number | null }): number | null {
  if (o.open == null || o.newItems == null || o.coveredPrices == null || o.unreadInvoiceItems == null) return null;
  return Math.max(0, o.open - o.newItems - o.coveredPrices - o.unreadInvoiceItems);
}
