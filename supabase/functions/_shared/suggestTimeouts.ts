// Samordnede frister for linjeforslag. Klientens frist (src/fakturaer/lib/aiLineSuggestion.ts) må være
// lengre enn hele serverbudsjettet, slik at klienten aldri gir opp mens serveren fortsatt jobber og logger.
// Test: src/test/originalGrounding.test.ts kontrollerer at verdiene henger sammen.
/** Hele serverens arbeid (original + tekstlag + AI). */
export const SUGGEST_SERVER_BUDGET_MS = 100_000;
/** Øvre grense for selve AI-kallet. */
export const SUGGEST_AI_MAX_MS = { pdf: 75_000, text: 45_000 } as const;
/** Minste meningsfulle AI-frist; mindre gjenstående budsjett gir tidsavbrudd uten kall. */
export const SUGGEST_AI_MIN_MS = 10_000;
/** Klientens frist (speilet i appen). */
export const SUGGEST_CLIENT_TIMEOUT_MS = 115_000;

export function aiTimeoutFor(startedAt: number, now: number, withPdf: boolean): number | null {
  const left = SUGGEST_SERVER_BUDGET_MS - (now - startedAt) - 2_000;
  const t = Math.min(withPdf ? SUGGEST_AI_MAX_MS.pdf : SUGGEST_AI_MAX_MS.text, left);
  return t >= SUGGEST_AI_MIN_MS ? t : null;
}
