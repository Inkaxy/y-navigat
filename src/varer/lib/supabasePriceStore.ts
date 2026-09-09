/**
 * Query-nøkler som må invalideres etter enhver prisendring.
 * Selve skrivingen skjer i `serverPriceWrite.ts` via databasefunksjonene
 * `set_price` / `set_prices` — klienten skriver aldri prisrader direkte.
 */
export const PRICE_QUERY_KEYS = [
  ["matrix-prices"],
  ["pricelist-items"],
  ["price-list-items"],
  ["product-prices"],
  ["product-margins"],
  ["profitability-sheet"],
  ["product-cost"],
] as const;
