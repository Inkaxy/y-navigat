// Regler for når oppskriftseditoren skal fylles på nytt fra serveren.
// Uten disse reglene nullstilte hver refetch (fanebytte, vindusfokus, lagring av
// merkedata) alt du hadde skrevet.

export type HydrationDecision =
  /** Fyll editoren fra serverdataene. */
  | "hydrate"
  /** Behold det som står i editoren — serverdataene er de samme som vi allerede har. */
  | "skip"
  /** Behold redigeringen, men si fra om at noen andre har lagret en nyere versjon. */
  | "conflict";

export interface HydrationInput {
  /** Oppskrifts-id som er hydrert inn i editoren nå. Null før første lasting. */
  loadedRecipeId: string | null;
  /** `updated_at` for versjonen som ble hydrert inn. */
  loadedUpdatedAt: string | null;
  /** Oppskrifts-id i det ferske svaret. */
  incomingRecipeId: string | null;
  /** `updated_at` i det ferske svaret. */
  incomingUpdatedAt: string | null;
  /** Har brukeren ulagrede endringer? */
  dirty: boolean;
}

/**
 * Avgjør hva som skal skje når et nytt serversvar kommer inn.
 * - Ny oppskrift, eller ingenting lastet ennå → hydrer.
 * - Nøyaktig samme versjon som allerede er hydrert → gjør ingenting, uansett om
 *   editoren er ren. Å hydrere identiske data på nytt gir bare nye objekter,
 *   som igjen utløser ny render og i verste fall en evig oppdateringsløkke.
 * - Ren editor og ny versjon fra serveren (inkludert egen lagring) → hydrer.
 * - Ulagrede endringer og nyere versjon → varsle, men aldri overskriv.
 */
export function decideHydration(input: HydrationInput): HydrationDecision {
  if (!input.incomingRecipeId) return "skip";
  if (input.loadedRecipeId !== input.incomingRecipeId) return "hydrate";

  const sameVersion =
    input.incomingUpdatedAt === input.loadedUpdatedAt ||
    !input.incomingUpdatedAt ||
    !input.loadedUpdatedAt;
  if (sameVersion) return "skip";
  return input.dirty ? "conflict" : "hydrate";
}
