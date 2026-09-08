/**
 * Kalkylekvalitet og sirkelsjekk for halvfabrikat.
 * Rene funksjoner — testes uten database.
 */

export type CalcQuality = "A" | "B" | "C" | "ukjent";

export const CALC_QUALITY_LABEL: Record<CalcQuality, string> = {
  A: "Komplett",
  B: "Oppskrift uten full kost",
  C: "Mangler kalkyle",
  ukjent: "Ukjent",
};

/**
 * A = kost komplett, B = har oppskrift/kilde men ufullstendig kost,
 * C = verken kost eller kobling, «ukjent» = ikke vurdert ennå.
 */
export function calcQuality(input: {
  hasCost: boolean;
  costPrice: number | null | undefined;
  hasRecipe: boolean;
  calcType: string | null | undefined;
  evaluated?: boolean;
}): CalcQuality {
  if (input.evaluated === false) return "ukjent";
  const cost = input.costPrice;
  const complete = input.hasCost && typeof cost === "number" && Number.isFinite(cost) && cost > 0;
  if (complete) return "A";
  if (input.hasRecipe || (input.calcType && input.calcType !== "oppskrift")) return "B";
  return "C";
}

/** Graf: vare → oppskrifter → varer brukt som halvfabrikat i oppskriften. */
export interface ProductGraph {
  /** Oppskrifter koblet til varen. */
  recipesOfProduct: Record<string, string[]>;
  /** Halvfabrikat-varer brukt i en oppskrift. */
  subProductsOfRecipe: Record<string, string[]>;
}

/**
 * Sjekker om det å bruke `subProductId` inne i `recipeId` (som hører til
 * `ownerProductId`) gir en sirkel. Returnerer stien når det gjør det.
 */
export function findCycle(
  graph: ProductGraph,
  ownerProductId: string,
  subProductId: string,
): string[] | null {
  const seen = new Set<string>();
  const stack: { productId: string; path: string[] }[] = [
    { productId: subProductId, path: [ownerProductId, subProductId] },
  ];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.productId === ownerProductId) return cur.path;
    if (seen.has(cur.productId)) continue;
    seen.add(cur.productId);
    for (const recipeId of graph.recipesOfProduct[cur.productId] ?? []) {
      for (const next of graph.subProductsOfRecipe[recipeId] ?? []) {
        stack.push({ productId: next, path: [...cur.path, next] });
      }
    }
  }
  return null;
}
