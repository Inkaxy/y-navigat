// Nøkkelhull-regler som kan testes uten å starte edge-funksjonen.
// Kilde: Mattilsynets veileder til nøkkelhullforskriften, produktgruppe 8 og 9.

/** Allergenkodene for glutenholdig korn slik de er lagret i `allergen_type`. */
export const GLUTEN_ALLERGEN_CODES = [
  "gluten_wheat",
  "gluten_rye",
  "gluten_barley",
  "gluten_oats",
  "gluten_spelt",
  "gluten_khorasan",
] as const;

/**
 * Glutenfritt: ingen av glutenkornenes allergenkoder er i «Inneholder».
 * Kodesjekk — IKKE tekstsøk i de norske etikettene («Hvete» inneholder ikke
 * ordet «gluten», så tekstsøket var alltid sant og ga feil fullkornkrav).
 */
export function isGlutenFreeFromCodes(containsCodes: readonly string[]): boolean {
  return !containsCodes.some((c) => (GLUTEN_ALLERGEN_CODES as readonly string[]).includes(c));
}

/** Glutenfrie produkter har lavere fullkornkrav (veilederen 4.2.1). */
export const GLUTEN_FREE_WHOLE_GRAIN_LIMIT: Record<string, number> = { "8a": 10, "8b": 15, "9": 15 };

/** Fullkornkravet i prosent av tørrstoff for en gruppe. */
export function wholeGrainLimitFor(group: "8a" | "8b" | "9", glutenFree: boolean, defaultLimit: number): number {
  if (!glutenFree) return defaultLimit;
  return GLUTEN_FREE_WHOLE_GRAIN_LIMIT[group] ?? defaultLimit;
}
