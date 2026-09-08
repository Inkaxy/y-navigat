// DENNE FILEN ER BYTE-IDENTISK MED src/varer/lib/units-recipe.ts.
// Endrer du én av dem, må du kopiere den andre. src/test/recipeUnitsMirror.test.ts
// slår ut hvis de kommer i utakt.
//
// Én enhetsmotor for oppskriftslinjer: mengde + enhet → gram, begge veier.
// Ingen importer — filen skal kunne leses både av Vite og av Deno.

/** Kanoniske enheter oppskriftslinjer kan bruke. */
export type RecipeUnit = "g" | "kg" | "ml" | "cl" | "dl" | "l" | "stk";

export const RECIPE_UNIT_ALIASES: Record<string, RecipeUnit> = {
  g: "g", gr: "g", gram: "g", grm: "g",
  kg: "kg", kilo: "kg", kilogram: "kg",
  ml: "ml", milliliter: "ml",
  cl: "cl", centiliter: "cl",
  dl: "dl", desiliter: "dl", deciliter: "dl",
  l: "l", lt: "l", ltr: "l", liter: "l", litre: "l",
  stk: "stk", st: "stk", stykk: "stk", pcs: "stk", pc: "stk",
};

/** Normaliserer en enhetstekst. Returnerer null for ukjente enheter. */
export function normalizeRecipeUnit(unit: string | null | undefined): RecipeUnit | null {
  if (!unit) return null;
  const k = String(unit).trim().toLowerCase().replace(/\.$/, "");
  return RECIPE_UNIT_ALIASES[k] ?? null;
}

/** Milliliter per volumenhet. */
export const ML_PER_UNIT: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };

export interface GramsResult {
  grams: number;
  /** Usann når vekten er anslått eller ukjent — da er beregningen ufullstendig. */
  exact: boolean;
  /** Forklaring som kan vises i grensesnittet når `exact` er usann. */
  reason?: string;
}

export interface ConvertOptions {
  /**
   * Tetthet i g/ml. Databasen har ingen tetthetskolonne på råvarer, så denne
   * settes bare når vi faktisk vet den (rent vann) eller kalleren oppgir den.
   */
  densityGPerMl?: number | null;
  /** Vekt per stykk i gram — `raw_materials.unit_weight_grams`. */
  pieceWeightG?: number | null;
}

/**
 * Regner en mengde om til gram.
 * Volum uten kjent tetthet og «stk» uten stykkvekt gir aldri en stille nullvekt —
 * resultatet merkes som ufullstendig med en forklaring.
 */
export function convertToGrams(
  quantity: number | string,
  unit: string,
  opts: ConvertOptions = {},
): GramsResult {
  const q = Number(quantity) || 0;
  const u = normalizeRecipeUnit(unit);
  if (!u) return { grams: 0, exact: false, reason: `Ukjent enhet «${unit}»` };
  if (u === "g") return { grams: q, exact: true };
  if (u === "kg") return { grams: q * 1000, exact: true };
  if (u === "stk") {
    const w = Number(opts.pieceWeightG) || 0;
    if (w > 0) return { grams: q * w, exact: true };
    return { grams: 0, exact: false, reason: "Mangler vekt per stykk" };
  }
  const ml = q * ML_PER_UNIT[u];
  const d = Number(opts.densityGPerMl) || 0;
  if (d > 0) return { grams: ml * d, exact: true };
  // Ingen kjent tetthet: vi antar IKKE vann. Vekten er ukjent, og beregningen
  // merkes som ufullstendig i stedet for å levere et oppdiktet tall.
  return { grams: 0, exact: false, reason: `Ukjent tetthet for ${u} — vekten kan ikke beregnes` };
}

/**
 * Motsatt vei: gram → oppgitt enhet. Returnerer NaN når omregningen er ukjent
 * (volum uten tetthet, «stk» uten stykkvekt), slik at kalleren må ta stilling
 * til det i stedet for å få et tall som ser riktig ut.
 */
export function fromGrams(grams: number, unit: string, opts: ConvertOptions = {}): number {
  const u = normalizeRecipeUnit(unit);
  if (!u) return NaN;
  if (u === "kg") return grams / 1000;
  if (u === "g") return grams;
  if (u === "stk") {
    const w = Number(opts.pieceWeightG) || 0;
    return w > 0 ? grams / w : NaN;
  }
  const d = Number(opts.densityGPerMl) || 0;
  if (d <= 0) return NaN;
  return grams / d / ML_PER_UNIT[u];
}

/**
 * Volummengde i liter, uavhengig av tetthet. Null når enheten ikke er et volum.
 * Brukes til priser oppgitt per liter — de trenger ingen tetthet.
 */
export function toLitres(quantity: number | string, unit: string): number | null {
  const u = normalizeRecipeUnit(unit);
  if (!u || !(u in ML_PER_UNIT)) return null;
  return ((Number(quantity) || 0) * ML_PER_UNIT[u]) / 1000;
}

export interface UnitCountRecipe {
  dough_piece_grams?: number | string | null;
  dough_waste_pct?: number | string | null;
  units_per_batch?: number | string | null;
  unit_weight_grams?: number | string | null;
}

/**
 * Antall emner en oppskrift gir. Emnevekten er sannheten: deigvekten minus
 * deigsvinn deles på `dough_piece_grams`. Uten emnevekt brukes `units_per_batch`
 * slik det er oppgitt, og til slutt `unit_weight_grams` som gammel fallback.
 * Null betyr «vet ikke» — aldri 0 som om oppskriften ikke ga noe.
 */
export function computeUnitCount(
  recipe: UnitCountRecipe | null | undefined,
  totalGrams: number,
): number | null {
  const total = Number(totalGrams) || 0;
  const waste = Number(recipe?.dough_waste_pct) || 0;
  const usable = total * (1 - waste / 100);
  const piece = Number(recipe?.dough_piece_grams) || 0;
  if (piece > 0) return usable > 0 ? Math.floor(usable / piece) : null;
  const perBatch = Number(recipe?.units_per_batch) || 0;
  if (perBatch > 0) return Math.round(perBatch);
  const legacy = Number(recipe?.unit_weight_grams) || 0;
  if (legacy > 0) return usable > 0 ? Math.floor(usable / legacy) : null;
  return null;
}

export interface FinalWeightRecipe {
  yield_grams?: number | string | null;
  finished_weight_grams?: number | string | null;
  yield_quantity?: number | string | null;
  yield_unit?: string | null;
  yield_loss_pct?: number | string | null;
}

/**
 * Ferdigvekt for en oppskrift, med kilden som ble brukt.
 * Prioritet: ferdigvekt per stk × antall → `yield_grams` → innveid vekt minus stektap.
 */
export function resolveFinalWeight(
  recipe: FinalWeightRecipe | null | undefined,
  inputGrams: number,
): { grams: number; source: string | null } {
  const per = recipe?.finished_weight_grams != null ? Number(recipe.finished_weight_grams) : null;
  const qty = recipe?.yield_quantity != null ? Number(recipe.yield_quantity) : null;
  const unit = String(recipe?.yield_unit ?? "").toLowerCase();
  if (per != null && per > 0 && qty != null && qty > 0 && (unit === "stk" || unit === "")) {
    return {
      grams: per * qty,
      source: `Ferdigvekt: ${qty} stk × ${per} g fra Oppskrift-fanen`,
    };
  }

  const y = recipe?.yield_grams != null ? Number(recipe.yield_grams) : null;
  if (y != null && y > 0) return { grams: y, source: `Ferdigvekt: ${y} g fra feltet «Utbytte (g)»` };

  const loss = Number(recipe?.yield_loss_pct) || 0;
  return {
    grams: (Number(inputGrams) || 0) * (1 - loss / 100) || 0,
    source: null,
  };
}
