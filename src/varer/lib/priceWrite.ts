/**
 * PRISREGNING
 * ---------------------------------------------------------------------------
 * Rene regnefunksjoner for pris og margin. Selve skrivingen ligger i
 * `serverPriceWrite.ts` (databasefunksjonene `set_price`/`set_prices`).
 */

/** Dagen før `date` (ISO yyyy-mm-dd), regnet i UTC for å unngå sommertidshopp. */
export function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const iso = d.toISOString();
  return `${iso.slice(0, 4)}-${iso.slice(5, 7)}-${iso.slice(8, 10)}`;
}

/**
 * Nødvendig pris for å nå et dekningsbidragsmål (DG2 i prosent av salgspris):
 *   pris = kost / (1 - mål/100)
 * Returnerer null når målet ikke gir en gyldig pris (>= 100 %).
 */
export function requiredPriceForTarget(
  cost: number | null | undefined,
  targetPct: number | null | undefined,
): number | null {
  if (cost == null || !Number.isFinite(cost) || cost < 0) return null;
  if (targetPct == null || !Number.isFinite(targetPct)) return null;
  if (targetPct >= 100) return null;
  const price = cost / (1 - targetPct / 100);
  if (!Number.isFinite(price)) return null;
  return Math.round(price * 100) / 100;
}

/** Dekningsgrad (DG2) i prosent av salgspris. */
export function marginPct(price: number | null | undefined, cost: number | null | undefined): number | null {
  if (price == null || cost == null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(cost) || price <= 0) return null;
  return Math.round(((price - cost) / price) * 1000) / 10;
}
