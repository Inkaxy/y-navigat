// EFFEKTIV DEKLARASJON (snapshot)
// products.manual_ingredient_declaration / manual_allergens_* / manual_nutrition_per_100g
// er EFFEKTIV deklarasjon — det som faktisk følger produktet. Kilden styres av
// declaration_mode på oppskrift (recipes) og kobling (product_recipe_links).
// Samme logikk finnes i frontend: src/varer/lib/effectiveDeclaration.ts

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

export const MIN_NUTRITION_COVERAGE_PCT = 90;

export type DeclarationMode = "auto" | "manual" | "auto_with_overrides";

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

export function pickNutrition(value: unknown): Record<string, number | null> | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const out: Record<string, number | null> = {};
  let any = false;
  for (const k of NUTRITION_KEYS) {
    const n = src[k];
    const num = n == null || n === "" ? NaN : Number(n);
    if (Number.isFinite(num)) {
      out[k] = num;
      any = true;
    } else {
      out[k] = null;
    }
  }
  return any ? out : null;
}

function parseAllergens(value: unknown): { contains: string[]; may_contain: string[] } {
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { contains: [], may_contain: [] };
    }
  }
  const o = (v ?? {}) as Record<string, unknown>;
  const arr = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
  return { contains: arr(o.contains), may_contain: arr(o.may_contain) };
}

interface CalculatedRow {
  ingredient_declaration: string | null;
  allergens: { contains?: string[]; may_contain?: string[] } | null;
  nutrition_per_100g: Record<string, number | null> | null;
  coverage_by_weight_pct: number | null;
}

/**
 * Synkroniserer effektiv deklarasjon for alle produkter koblet til en oppskrift.
 * «auto» får beregningen som snapshot, «auto_with_overrides» beregnes på nytt via
 * compute-product-declaration, og «manual» røres aldri.
 */
export async function syncAutoProductsForRecipe(
  service: SupabaseClient,
  recipeId: string,
  calculated: CalculatedRow,
): Promise<number> {
  const { data: recipe, error: recipeErr } = await service
    .from("recipes")
    .select("declaration_mode")
    .eq("id", recipeId)
    .maybeSingle();
  // Aldri gjett modus: uten et sikkert oppslag kan vi overskrive manuelle snapshots.
  if (recipeErr || !recipe) {
    console.error("syncAutoProductsForRecipe: kunne ikke lese oppskriftsmodus", recipeId, recipeErr?.message);
    return 0;
  }
  const recipeMode = (recipe.declaration_mode ?? "auto") as DeclarationMode;

  const { data: links, error: linksErr } = await service
    .from("product_recipe_links")
    .select("id, product_id, declaration_mode")
    .eq("recipe_id", recipeId);
  if (linksErr) {
    console.error("syncAutoProductsForRecipe: kunne ikke lese koblinger", recipeId, linksErr.message);
    return 0;
  }
  if (!links?.length) return 0;

  const coverage = calculated.coverage_by_weight_pct ?? 0;
  const coverageOk = coverage >= MIN_NUTRITION_COVERAGE_PCT;
  const payload = {
    manual_ingredient_declaration: stripHtml(calculated.ingredient_declaration) || null,
    manual_allergens_contains: calculated.allergens?.contains ?? [],
    manual_allergens_may_contain: calculated.allergens?.may_contain ?? [],
    // Under 90 % dekning skal næringstabellen ikke ut på emballasje.
    manual_nutrition_per_100g: coverageOk ? pickNutrition(calculated.nutrition_per_100g) : null,
    manual_declaration_updated_at: new Date().toISOString(),
  };

  let n = 0;
  for (const link of links) {
    const mode = ((link.declaration_mode as DeclarationMode | null) ?? recipeMode) as DeclarationMode;
    if (mode === "manual") continue;

    if (mode === "auto_with_overrides") {
      const ok = await syncOverrideLink(service, link.id as string, link.product_id as string);
      if (ok) n++;
      continue;
    }

    const { error } = await service.from("products").update(payload).eq("id", link.product_id);
    if (error) {
      console.error("syncAutoProductsForRecipe", link.product_id, error.message);
      continue;
    }
    n++;
  }
  return n;
}

/**
 * Beregner deklarasjonen på nytt for en kobling med overstyringer og skriver
 * snapshotet. Feiler beregningen, flagges produktet for gjennomgang i stedet for
 * å bli stående stille utdatert.
 */
async function syncOverrideLink(
  service: SupabaseClient,
  linkId: string,
  productId: string,
): Promise<boolean> {
  try {
    const { data, error } = await service.functions.invoke("compute-product-declaration", {
      body: { product_recipe_link_id: linkId },
    });
    if (error) throw error;
    const c = (data ?? {}) as {
      ingredient_declaration_html?: string | null;
      allergens_contains?: string[];
      allergens_may_contain?: string[];
      nutrition_per_100g?: Record<string, number | null> | null;
      data_quality?: { nutrition_coverage_pct?: number | null };
    };
    const coverage = c.data_quality?.nutrition_coverage_pct ?? 0;
    const { error: upErr } = await service
      .from("products")
      .update({
        manual_ingredient_declaration: stripHtml(c.ingredient_declaration_html) || null,
        manual_allergens_contains: c.allergens_contains ?? [],
        manual_allergens_may_contain: c.allergens_may_contain ?? [],
        manual_nutrition_per_100g:
          coverage >= MIN_NUTRITION_COVERAGE_PCT ? pickNutrition(c.nutrition_per_100g) : null,
        manual_declaration_updated_at: new Date().toISOString(),
        declaration_needs_review: false,
        declaration_review_reason: null,
      })
      .eq("id", productId);
    if (upErr) throw upErr;
    return true;
  } catch (e) {
    console.error("syncOverrideLink", linkId, (e as Error).message);
    await service
      .from("products")
      .update({
        declaration_needs_review: true,
        declaration_review_reason: "Beregningen er oppdatert — overstyringene må synkes",
      })
      .eq("id", productId);
    return false;
  }
}


export { parseAllergens };
