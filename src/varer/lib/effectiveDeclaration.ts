import { supabase } from "@/integrations/supabase/client";

/**
 * EFFEKTIV DEKLARASJON
 * ---------------------------------------------------------------------------
 * `products.manual_ingredient_declaration`, `manual_allergens_contains`,
 * `manual_allergens_may_contain` og `manual_nutrition_per_100g` er IKKE lenger
 * «bare manuelle felter». De er EFFEKTIV DEKLARASJON (et snapshot) — altså det
 * som faktisk følger produktet på etikett, i nettbutikken og i ordredialogen.
 * Kilden styres av `declaration_mode` på oppskriften (`recipes`) og på koblingen
 * (`product_recipe_links`, som overstyrer oppskriften).
 *
 * Synken kjøres når modus endres, når manuelle felter lagres, og etter hver
 * `compute-recipe-label`-kjøring (samme logikk finnes i edge-funksjonen
 * `_shared/effective-declaration.ts`).
 */

export type DeclarationMode = "auto" | "manual" | "auto_with_overrides";

export const NUTRITION_KEYS = [
  "energy_kj",
  "energy_kcal",
  "fat_g",
  "saturated_fat_g",
  "carbs_g",
  "sugars_g",
  "protein_g",
  "salt_g",
  "fiber_g",
] as const;

export type NutritionKey = (typeof NUTRITION_KEYS)[number];
export type NutritionPer100g = Partial<Record<NutritionKey, number | null>>;

/** Minste datadekning før beregnet næring kan brukes på emballasje. */
export const MIN_NUTRITION_COVERAGE_PCT = 90;

export type EffectiveSource =
  | "link_manual"
  | "recipe_manual"
  | "calculated"
  | "product_declaration";

export interface EffectiveDeclaration {
  mode: DeclarationMode;
  source: EffectiveSource;
  ingredientText: string | null;
  contains: string[];
  mayContain: string[];
  nutrition: NutritionPer100g | null;
  /** Satt når kilden er beregningen. */
  coveragePct: number | null;
  /** Beregnet næring ble forkastet fordi dekningen er for lav. */
  nutritionSuppressed: boolean;
}

export interface AllergenSummary {
  contains: string[];
  may_contain: string[];
}

/** Fjerner HTML-koder og normaliserer mellomrom. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Leser allergensammendrag som enten er lagret som objekt eller som JSON-tekst. */
export function parseAllergenSummary(value: unknown): AllergenSummary {
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { contains: [], may_contain: [] };
    }
  }
  const o = (v ?? {}) as Record<string, unknown>;
  const arr = (x: unknown): string[] =>
    Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : [];
  return { contains: arr(o.contains), may_contain: arr(o.may_contain) };
}

/** Plukker de ni næringsnøklene ut av et vilkårlig objekt. */
export function pickNutrition(value: unknown): NutritionPer100g | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const out: NutritionPer100g = {};
  let any = false;
  for (const k of NUTRITION_KEYS) {
    const n = src[k];
    if (n == null || n === "") {
      out[k] = null;
      continue;
    }
    const num = Number(n);
    if (Number.isFinite(num)) {
      out[k] = num;
      any = true;
    } else {
      out[k] = null;
    }
  }
  return any ? out : null;
}

interface LinkRow {
  id: string;
  product_id: string;
  recipe_id: string | null;
  declaration_mode: DeclarationMode | null;
  manual_ingredient_declaration: string | null;
  manual_nutrition: unknown;
  manual_allergen_summary: unknown;
  recipes: {
    declaration_mode: DeclarationMode | null;
    manual_ingredient_declaration: string | null;
    manual_nutrition: unknown;
    manual_allergen_summary: unknown;
  } | null;
}

export interface RecipeLabelSnapshot {
  ingredient_declaration: string | null;
  allergens: { contains?: string[]; may_contain?: string[] } | null;
  nutrition_per_100g: Record<string, number | null> | null;
  coverage_by_weight_pct: number | null;
}

const LINK_SELECT =
  "id, product_id, recipe_id, declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary, recipes(declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary)";

/** Effektiv modus: koblingen vinner over oppskriften, ellers «auto». */
export function effectiveMode(
  linkMode: DeclarationMode | null | undefined,
  recipeMode: DeclarationMode | null | undefined,
): DeclarationMode {
  return linkMode ?? recipeMode ?? "auto";
}

/** Bygger effektiv deklarasjon ut fra modus, manuelle felter og beregningen. */
export function buildEffectiveDeclaration(
  link: LinkRow,
  calculated: RecipeLabelSnapshot | null,
): EffectiveDeclaration {
  const mode = effectiveMode(link.declaration_mode, link.recipes?.declaration_mode);

  if (mode === "manual") {
    const linkAllergens = parseAllergenSummary(link.manual_allergen_summary);
    const useLink =
      !!link.manual_ingredient_declaration ||
      !!pickNutrition(link.manual_nutrition) ||
      linkAllergens.contains.length > 0 ||
      linkAllergens.may_contain.length > 0;
    const src = useLink ? link : link.recipes;

    const allergens = parseAllergenSummary(src?.manual_allergen_summary);
    return {
      mode,
      source: useLink ? "link_manual" : "recipe_manual",
      ingredientText: stripHtml(src?.manual_ingredient_declaration) || null,
      contains: allergens.contains,
      mayContain: allergens.may_contain,
      nutrition: pickNutrition(src?.manual_nutrition),
      coveragePct: null,
      nutritionSuppressed: false,
    };
  }

  const coverage = calculated?.coverage_by_weight_pct ?? null;
  const coverageOk = (coverage ?? 0) >= MIN_NUTRITION_COVERAGE_PCT;
  return {
    mode,
    source: "calculated",
    ingredientText: stripHtml(calculated?.ingredient_declaration) || null,
    contains: calculated?.allergens?.contains ?? [],
    mayContain: calculated?.allergens?.may_contain ?? [],
    // Under 90 % dekning skal næringstabellen ikke ut på emballasje.
    nutrition: coverageOk ? pickNutrition(calculated?.nutrition_per_100g) : null,
    coveragePct: coverage,
    nutritionSuppressed: !coverageOk,
  };
}

async function fetchCalculated(recipeId: string): Promise<RecipeLabelSnapshot | null> {
  const { data } = await supabase
    .from("recipe_label_calculated")
    .select("ingredient_declaration, allergens, nutrition_per_100g, coverage_by_weight_pct")
    .eq("recipe_id", recipeId)
    .maybeSingle();
  return (data ?? null) as RecipeLabelSnapshot | null;
}

/**
 * Skriver snapshotet til produktet.
 * MERK: nettbutikkens næringstabell (`product_nutrition_calculated`) er en VIEW som
 * regnes ut fra oppskriftslinjene — den kan ikke skrives til. Manuell næring når
 * derfor ikke nettbutikken uten en databaseendring (view → tabell, eller at
 * `push_products_to_nettside` leser `products.manual_nutrition_per_100g`).
 */
async function writeSnapshot(productId: string, eff: EffectiveDeclaration) {

  const { error } = await supabase
    .from("products")
    .update({
      manual_ingredient_declaration: eff.ingredientText,
      manual_allergens_contains: eff.contains,
      manual_allergens_may_contain: eff.mayContain,
      manual_nutrition_per_100g: (eff.nutrition ?? null) as never,
      manual_declaration_updated_at: new Date().toISOString(),
    })
    .eq("id", productId);
  if (error) throw error;
}

/** Synkroniserer én produkt/oppskrift-kobling. Returnerer det som ble skrevet. */
export async function syncEffectiveDeclaration(linkId: string): Promise<EffectiveDeclaration | null> {
  const { data, error } = await supabase
    .from("product_recipe_links")
    .select(LINK_SELECT)
    .eq("id", linkId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const link = data as unknown as LinkRow;

  if (effectiveMode(link.declaration_mode, link.recipes?.declaration_mode) === "auto_with_overrides") {
    const { data: computed, error: fnErr } = await supabase.functions.invoke(
      "compute-product-declaration",
      { body: { product_recipe_link_id: link.id } },
    );
    if (fnErr) throw fnErr;
    const c = computed as {
      ingredient_declaration_html?: string | null;
      allergens_contains?: string[];
      allergens_may_contain?: string[];
      nutrition_per_100g?: Record<string, number | null> | null;
      data_quality?: { nutrition_coverage_pct?: number | null };
    };
    const coverage = c.data_quality?.nutrition_coverage_pct ?? null;
    const coverageOk = (coverage ?? 0) >= MIN_NUTRITION_COVERAGE_PCT;
    const eff: EffectiveDeclaration = {
      mode: "auto_with_overrides",
      source: "calculated",
      ingredientText: stripHtml(c.ingredient_declaration_html) || null,
      contains: c.allergens_contains ?? [],
      mayContain: c.allergens_may_contain ?? [],
      nutrition: coverageOk ? pickNutrition(c.nutrition_per_100g) : null,
      coveragePct: coverage,
      nutritionSuppressed: !coverageOk,
    };
    await writeSnapshot(link.product_id, eff);
    return eff;
  }

  const calculated = link.recipe_id ? await fetchCalculated(link.recipe_id) : null;
  const eff = buildEffectiveDeclaration(link, calculated);
  await writeSnapshot(link.product_id, eff);
  return eff;
}

/** Synkroniserer alle produkter som er koblet til en oppskrift. */
export async function syncEffectiveDeclarationForRecipe(recipeId: string): Promise<number> {
  const { data, error } = await supabase
    .from("product_recipe_links")
    .select("id")
    .eq("recipe_id", recipeId);
  if (error) throw error;
  const links = data ?? [];
  let n = 0;
  for (const l of links) {
    try {
      await syncEffectiveDeclaration(l.id);
      n++;
    } catch (e) {
      console.error("syncEffectiveDeclaration", l.id, e);
    }
  }
  return n;
}

/** Sammenligner beregnet mot manuell for å oppdage at beregningen har flyttet seg. */
export function declarationDrift(
  manual: { nutrition: NutritionPer100g | null; contains: string[] },
  calculated: RecipeLabelSnapshot | null,
): string | null {
  if (!calculated) return null;
  const calcNut = pickNutrition(calculated.nutrition_per_100g);
  const manualKcal = manual.nutrition?.energy_kcal;
  const calcKcal = calcNut?.energy_kcal;
  if (manualKcal != null && calcKcal != null && manualKcal > 0) {
    const diff = Math.abs(calcKcal - manualKcal) / manualKcal;
    if (diff > 0.1) {
      return `Beregnet energi er nå ${Math.round(calcKcal)} kcal mot ${Math.round(manualKcal)} kcal i den manuelle deklarasjonen.`;
    }
  }
  const calcContains = (calculated.allergens?.contains ?? []).map((s) => s.toLowerCase()).sort();
  const manContains = manual.contains.map((s) => s.toLowerCase()).sort();
  if (calcContains.join("|") !== manContains.join("|")) {
    return `Beregnet allergenliste (${calcContains.join(", ") || "ingen"}) er ikke lik den manuelle (${manContains.join(", ") || "ingen"}).`;
  }
  return null;
}
