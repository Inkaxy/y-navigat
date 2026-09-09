// Ren mapping-logikk for matvaretabellen-sync — ingen nettverk eller database her,
// slik at reglene kan testes uten å slå opp mot Mattilsynets API.

/** Konstituent slik den kommer fra foods.json. */
export interface RawConstituent {
  sourceId?: string;
  nutrientId: string;
  quantity?: number;
  unit?: string;
}

/** Én matvare fra foods.json. */
export interface RawFood {
  foodId: string;
  foodName: string;
  latinName?: string | null;
  uri?: string | null;
  foodGroupId?: string | null;
  langualCodes?: string[] | null;
  searchKeywords?: string[] | null;
  portions?: unknown;
  calories?: { quantity?: number; unit?: string } | null;
  energy?: { quantity?: number; unit?: string } | null;
  ediblePart?: { percent?: number } | null;
  constituents?: RawConstituent[] | null;
}

/** Matvaregruppe fra food-groups.json. */
export interface RawFoodGroup {
  foodGroupId: string;
  name: string;
  parentId?: string | null;
}

/** Næringsstoff fra nutrients.json — brukes til enhet når konstituenten selv mangler den. */
export interface RawNutrient {
  nutrientId: string;
  name: string;
  unit?: string | null;
}

/** Én rad i matvaretabellen_foods, uten de genererte *_norm-kolonnene. */
export interface MappedFoodRow {
  food_id: string;
  food_name: string;
  latin_name: string | null;
  uri: string | null;
  food_group_id: string | null;
  food_group_name: string | null;
  langual_codes: string[];
  search_keywords: string[] | null;
  portions: unknown | null;
  energy_kcal: number | null;
  energy_kj: number | null;
  edible_part_pct: number | null;
  constituents: Record<string, { quantity: number; unit: string }>;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  protein_g: number | null;
  salt_g: number | null;
  saturated_fat_g: number | null;
  starch_g: number | null;
  sugars_g: number | null;
  water_g: number | null;
  mono_unsat_g: number | null;
  poly_unsat_g: number | null;
  trans_fat_g: number | null;
  sodium_mg: number | null;
  added_sugar_g: number | null;
  cholesterol_mg: number | null;
  is_stale: boolean;
  synced_at: string;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Bygger constituents-kartet ({nutrientId: {quantity, unit}}). Konstituenter uten
 * numerisk quantity hoppes over (de finnes bare som "denne kilden vet ikke" i
 * kildedataene). Enhet hentes fra konstituenten selv, ellers fra nutrients.json —
 * ALDRI fra sourceId, som er en kildereferanse, ikke en enhet.
 */
export function buildConstituents(
  raw: RawConstituent[] | null | undefined,
  nutrientUnitById: Map<string, string>,
): Record<string, { quantity: number; unit: string }> {
  const out: Record<string, { quantity: number; unit: string }> = {};
  for (const c of raw ?? []) {
    const qty = num(c.quantity);
    if (qty == null) continue;
    const unit = c.unit ?? nutrientUnitById.get(c.nutrientId) ?? "";
    out[c.nutrientId] = { quantity: qty, unit };
  }
  return out;
}

/** Nøkler i constituents-kartet vi henter enkeltverdier fra til egne kolonner. */
const PICK_KEYS: Record<string, string> = {
  mono_unsat_g: "Enumet",
  poly_unsat_g: "Flerum",
  trans_fat_g: "Trans",
  sodium_mg: "Na",
  added_sugar_g: "Sukker",
  cholesterol_mg: "Kolest",
};

/** Plukker ut quantity for én nutrientId fra constituents-kartet. */
export function pick(
  constituents: Record<string, { quantity: number; unit: string }>,
  nutrientId: string,
): number | null {
  return constituents[nutrientId]?.quantity ?? null;
}

/** Mapper én RawFood + oppslagstabeller til en rad klar for upsert. */
export function mapFood(
  food: RawFood,
  foodGroupNameById: Map<string, string>,
  nutrientUnitById: Map<string, string>,
  syncedAt: string,
): MappedFoodRow {
  const constituents = buildConstituents(food.constituents, nutrientUnitById);
  const groupId = food.foodGroupId ?? null;

  return {
    food_id: food.foodId,
    food_name: food.foodName,
    latin_name: food.latinName ?? null,
    uri: food.uri ?? null,
    food_group_id: groupId,
    food_group_name: groupId ? foodGroupNameById.get(groupId) ?? null : null,
    langual_codes: food.langualCodes ?? [],
    search_keywords: food.searchKeywords ?? null,
    portions: food.portions ?? null,
    energy_kcal: num(food.calories?.quantity),
    energy_kj: num(food.energy?.quantity),
    edible_part_pct: num(food.ediblePart?.percent),
    constituents,
    carbs_g: pick(constituents, "Karbo"),
    fat_g: pick(constituents, "Fett"),
    fiber_g: pick(constituents, "Fiber"),
    protein_g: pick(constituents, "Protein"),
    salt_g: pick(constituents, "NaCl"),
    saturated_fat_g: pick(constituents, "Mettet"),
    starch_g: pick(constituents, "Stivel"),
    sugars_g: pick(constituents, "Mono+Di"),
    water_g: pick(constituents, "Vann"),
    mono_unsat_g: pick(constituents, PICK_KEYS.mono_unsat_g),
    poly_unsat_g: pick(constituents, PICK_KEYS.poly_unsat_g),
    trans_fat_g: pick(constituents, PICK_KEYS.trans_fat_g),
    sodium_mg: pick(constituents, PICK_KEYS.sodium_mg),
    added_sugar_g: pick(constituents, PICK_KEYS.added_sugar_g),
    cholesterol_mg: pick(constituents, PICK_KEYS.cholesterol_mg),
    is_stale: false,
    synced_at: syncedAt,
  };
}

/** Kolonner som ALDRI skal sendes i upsert — de genereres av databasen selv. */
export const GENERATED_COLUMNS = ["food_name_norm", "search_keywords_norm"] as const;
