// Velger hovedbokskonto for en leverandørfaktura ut fra bilagets posteringer.
// Bare kostnadskontoer (3000–7999) vurderes. Er det flere ulike slike kontoer,
// klarer vi ikke å peke ut én konto, og vi setter ingen.
//
// Priskontroll v2: bilagets posteringer gir også inngående mva (konto 2700–2749)
// når regnskapssystemet ikke leverer mva-beløpet på fakturahodet.

export interface VoucherPosting {
  account?: { number?: number | string | null } | null;
  amountGross?: number | null;
  amount?: number | null;
}

const MIN_ACCOUNT = 3000;
const MAX_ACCOUNT = 7999;
const VAT_MIN_ACCOUNT = 2700;
const VAT_MAX_ACCOUNT = 2749;

function accountNumber(posting: VoucherPosting | null): number | null {
  const value = posting?.account?.number;
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Returnerer kontonummeret som streng når nøyaktig én kostnadskonto er brukt. */
export function pickLedgerAccount(postings: unknown): string | null {
  if (!Array.isArray(postings)) return null;
  const accounts = new Set<string>();
  for (const raw of postings) {
    const n = accountNumber(raw as VoucherPosting | null);
    if (n == null) continue;
    if (n < MIN_ACCOUNT || n > MAX_ACCOUNT) continue;
    accounts.add(String(n));
  }
  if (accounts.size !== 1) return null;
  return [...accounts][0];
}

/**
 * Inngående mva fra bilagets posteringer (sum av beløp på 2700–2749), som positivt tall.
 * null når ingen slike posteringer finnes.
 */
export function vatFromPostings(postings: unknown): number | null {
  if (!Array.isArray(postings)) return null;
  let sum = 0;
  let found = false;
  for (const raw of postings) {
    const p = raw as VoucherPosting | null;
    const n = accountNumber(p);
    if (n == null || n < VAT_MIN_ACCOUNT || n > VAT_MAX_ACCOUNT) continue;
    const amt = Number(p?.amountGross ?? p?.amount ?? 0);
    if (!Number.isFinite(amt)) continue;
    sum += amt;
    found = true;
  }
  if (!found) return null;
  return Math.round(Math.abs(sum) * 100) / 100;
}

