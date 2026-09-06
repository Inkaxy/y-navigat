// Kart fra råvarekategori til matvaregrupper i Matvaretabellen.
// Brukes til å løfte sannsynlige treff og dempe åpenbart feil gruppe
// når vi foreslår kobling automatisk.

import { normalizeForSearch } from "@/lib/textSimilarity";

export const CATEGORY_FOOD_GROUPS: Record<string, readonly string[]> = {
  "Mel og korn": ["Mel", "Gryn, ris og pasta", "Frokostblanding", "Deiger og farser"],
  "Sukker og søtning": ["Sukker og honning", "Søte pålegg"],
  "Fett og olje": ["Margarin og smør", "Matolje", "Annet fett"],
  "Meieri og egg": [
    "Melk",
    "Fløte og rømme",
    "Yoghurt",
    "Gulost",
    "Brunost",
    "Ferskost",
    "Annen ost",
    "Muggost",
    "Smelteost",
    "Egg",
  ],
  "Gjær, hevemidler og bakehjelpemidler": ["Diverse ingredienser"],
  "Frø, nøtter og kjerner": ["Frø", "Nøtter", "Produkter av nøtter og frø"],
  "Frukt, bær og syltetøy": ["Frukt", "Bær", "Produkter av frukt og bær", "Søte pålegg"],
  "Sjokolade og kakao": ["Sjokolade og godteri", "Diverse ingredienser"],
  "Marsipan, masser og fyll": ["Sjokolade og godteri", "Produkter av nøtter og frø", "Dessert og iskrem"],
  "Dekor og glasur": ["Sjokolade og godteri", "Sukker og honning", "Diverse ingredienser"],
  "Smak, krydder og tilsetning": ["Urter og krydder", "Diverse ingredienser"],
  "Ferdigmiks og halvfabrikat": ["Mel", "Deiger og farser", "Diverse ingredienser"],
  "Pålegg og delikatesse": [
    "Kjøttprodukter",
    "Majones og påleggsalater",
    "Søte pålegg",
    "Fiskeprodukter",
    "Gulost",
  ],
  "Kaffe og te": ["Kaffe og te"],
  Drikke: [
    "Brus og energidrikke",
    "Juice og smoothie",
    "Vann og mineralvann",
    "Plantebasert drikke",
    "Alkoholholdige drikkevarer",
  ],
};

/** Kategorier som aldri skal kobles til Matvaretabellen. */
export const NON_FOOD_CATEGORIES: readonly string[] = ["Emballasje", "Forbruksvarer"];

export function isNonFoodCategory(category: string | null | undefined): boolean {
  return !!category && NON_FOOD_CATEGORIES.includes(category);
}

/**
 * Faktor som ganges med grunnpoengsummen:
 * 1,15 når matvaregruppen passer kategorien, 0,75 når den åpenbart ikke gjør det,
 * 1 når vi ikke vet.
 */
export function foodGroupFit(category: string | null | undefined, foodGroupName: string | null | undefined): number {
  if (!category) return 1;
  const allowed = CATEGORY_FOOD_GROUPS[category];
  if (!allowed || allowed.length === 0) return 1;
  if (!foodGroupName) return 1;
  const g = normalizeForSearch(foodGroupName);
  return allowed.some((a) => normalizeForSearch(a) === g) ? 1.15 : 0.75;
}
