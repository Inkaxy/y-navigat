/**
 * Allergenstatus i listen: vurdering (fra `allergens_reviewed_at`) holdes adskilt fra om det finnes
 * registrerte allergener. Vurdert + ingen = ferdig; registrerte rader uten vurdering er ikke vurdert.
 * Ukjent vurdering (feltet ikke lest) vises aldri som vurdert.
 */
export type AllergenState = "vurdert_ingen" | "vurdert_med" | "ikke_vurdert" | "ukjent";

export function allergenState(reviewed: boolean | null, hasAllergens: boolean): AllergenState {
  if (reviewed == null) return "ukjent";
  if (!reviewed) return "ikke_vurdert";
  return hasAllergens ? "vurdert_med" : "vurdert_ingen";
}

export const ALLERGEN_STATE_LABEL: Record<AllergenState, string> = {
  vurdert_ingen: "Allergener: vurdert, ingen registrert",
  vurdert_med: "Allergener: vurdert, registrert",
  ikke_vurdert: "Allergener: ikke vurdert",
  ukjent: "Allergener: vurdering ukjent",
};

/** Fra rå råvarerad: undefined = ikke lest (ukjent), null/tom = ikke vurdert. */
export function reviewedFrom(v: string | null | undefined): boolean | null {
  return v === undefined ? null : !!v;
}
