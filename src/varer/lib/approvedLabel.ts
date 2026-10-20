import type { EffectiveDeclaration, NutritionPer100g } from "@/varer/lib/effectiveDeclaration";

/**
 * SIST GODKJENTE ETIKETT
 * ---------------------------------------------------------------------------
 * Godkjent deklarasjonsversjon er fasit for forhåndsvisning, kopi og utskrift.
 * NULL i versjonen er autoritativt («ikke godkjent oppgitt») — vi faller aldri
 * tilbake til løpende beregning. Ny beregning vises bare som kladd/forslag.
 */
export interface ApprovedVersionLike {
  version: number;
  approved_at: string | null;
  ingredient_text: string | null;
  ingredient_html?: string | null;
  allergens_contains: string[] | null;
  allergens_may_contain: string[] | null;
  nutrition_per_100g: unknown;
  coverage_pct: number | null;
  net_weight_g: number | null;
  shelf_life_days: number | null;
  storage_text: string | null;
  origin_text: string | null;
  claim_grain: boolean | null;
  claim_keyhole: boolean | null;
  breadscale_pct: number | null;
}

export type LabelSource = "approved" | "draft";

/** Godkjent er standard når en versjon finnes; uten versjon finnes bare kladd. */
export function defaultLabelSource(hasApproved: boolean): LabelSource {
  return hasApproved ? "approved" : "draft";
}

function nutritionOf(v: unknown): NutritionPer100g | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: NutritionPer100g = {};
  let any = false;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = raw == null || raw === "" ? NaN : Number(raw);
    if (Number.isFinite(n)) {
      (out as Record<string, number>)[k] = n;
      any = true;
    }
  }
  return any ? out : null;
}

export interface ApprovedLabelInput {
  effective: EffectiveDeclaration;
  grainPct: number | null;
  claimGrain: boolean;
  claimKeyhole: boolean;
  unitWeightGrams: number | null;
  shelfLifeDays: number | null;
  storageInstructions: string | null;
  countryOfOrigin: string | null;
  nutritionUsable: boolean;
}

export function approvedLabelInput(v: ApprovedVersionLike): ApprovedLabelInput {
  const nutrition = nutritionOf(v.nutrition_per_100g);
  return {
    effective: {
      mode: "auto",
      source: "product_declaration",
      ingredientText: v.ingredient_text ?? null,
      contains: v.allergens_contains ?? [],
      mayContain: v.allergens_may_contain ?? [],
      nutrition,
      coveragePct: v.coverage_pct ?? null,
      nutritionSuppressed: false,
    },
    grainPct: v.breadscale_pct ?? null,
    claimGrain: !!v.claim_grain,
    claimKeyhole: !!v.claim_keyhole,
    unitWeightGrams: v.net_weight_g ?? null,
    shelfLifeDays: v.shelf_life_days ?? null,
    storageInstructions: v.storage_text ?? null,
    countryOfOrigin: v.origin_text ?? null,
    nutritionUsable: nutrition != null,
  };
}

/** Produktets publiserte deklarasjon for forhåndsvisning/kopi/utskrift. */
export interface PublishedProductDeclaration {
  kind: "approved_version" | "legacy";
  version: number | null;
  ingredientHtml: string;
  contains: string[];
  mayContain: string[];
  nutrition: NutritionPer100g | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** *stjerner* → <strong>, slik at uthevede allergener overlever i forhåndsvisningen. */
export function markedTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
}

/**
 * Versjonert produkt → godkjent versjon (også når versjonen har NULL-felt).
 * Uten versjon → produktets lagrede snapshot som eksplisitt «legacy».
 * Uten noe snapshot → null (ingenting godkjent å vise).
 */
export function publishedProductDeclaration(input: {
  versionId: string | null;
  version: (ApprovedVersionLike & { id: string }) | null;
  product: {
    manual_ingredient_declaration: string | null;
    manual_allergens_contains: string[] | null;
    manual_allergens_may_contain: string[] | null;
    manual_nutrition_per_100g: unknown;
  } | null;
}): PublishedProductDeclaration | null {
  const { versionId, version, product } = input;
  if (versionId) {
    if (!version || version.id !== versionId) return null;
    const html = version.ingredient_html?.trim()
      ? version.ingredient_html
      : markedTextToHtml(version.ingredient_text ?? "");
    return {
      kind: "approved_version",
      version: version.version,
      ingredientHtml: html,
      contains: version.allergens_contains ?? [],
      mayContain: version.allergens_may_contain ?? [],
      nutrition: nutritionOf(version.nutrition_per_100g),
    };
  }
  const text = product?.manual_ingredient_declaration?.trim();
  if (!product || !text) return null;
  return {
    kind: "legacy",
    version: null,
    ingredientHtml: markedTextToHtml(text),
    contains: product.manual_allergens_contains ?? [],
    mayContain: product.manual_allergens_may_contain ?? [],
    nutrition: nutritionOf(product.manual_nutrition_per_100g),
  };
}
