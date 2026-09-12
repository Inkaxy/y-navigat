/** Enhetene oppskriftslinjer kan velge mellom i griddet. */
export const RECIPE_UNIT_OPTIONS = ["g", "kg", "ml", "cl", "dl", "l", "stk"] as const;

/**
 * Valgene som skal vises for en linje. Eldre linjer kan ha lagrede enheter som
 * «liter» — de legges først i lista slik at de vises som valgt, uten at vi
 * skriver om en urørt oppskrift.
 */
export function unitOptionsFor(unit: string | null | undefined): string[] {
  const u = (unit ?? "").trim();
  if (!u || RECIPE_UNIT_OPTIONS.includes(u as (typeof RECIPE_UNIT_OPTIONS)[number])) {
    return [...RECIPE_UNIT_OPTIONS];
  }
  return [u, ...RECIPE_UNIT_OPTIONS];
}
