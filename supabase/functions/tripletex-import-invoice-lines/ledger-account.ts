// Velger hovedbokskonto for en leverandørfaktura ut fra bilagets posteringer.
// Bare kostnadskontoer (3000–7999) vurderes. Er det flere ulike slike kontoer,
// klarer vi ikke å peke ut én konto, og vi setter ingen.

export interface VoucherPosting {
  account?: { number?: number | string | null } | null;
  amountGross?: number | null;
  amount?: number | null;
}

const MIN_ACCOUNT = 3000;
const MAX_ACCOUNT = 7999;

/** Returnerer kontonummeret som streng når nøyaktig én kostnadskonto er brukt. */
export function pickLedgerAccount(postings: unknown): string | null {
  if (!Array.isArray(postings)) return null;
  const accounts = new Set<string>();
  for (const raw of postings) {
    const posting = raw as VoucherPosting | null;
    const value = posting?.account?.number;
    if (value == null) continue;
    const num = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(num)) continue;
    const rounded = Math.trunc(num);
    if (rounded < MIN_ACCOUNT || rounded > MAX_ACCOUNT) continue;
    accounts.add(String(rounded));
  }
  if (accounts.size !== 1) return null;
  return [...accounts][0];
}
