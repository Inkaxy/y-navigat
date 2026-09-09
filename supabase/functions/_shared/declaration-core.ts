// Delt kjerne for deklarasjonsberegning.
// Brukes av compute-product-declaration (produkt-kobling) og compute-recipe-label (oppskrift).
// Håndterer: gram-konvertering, svinn, rekursiv dekomponering av sammensatte råvarer,
// aggregering, QUID, allergener, næring og Brødskala'n.
//
// SVINN — ÉN DEFINISJON:
// `waste_percent` er EKSTRA innveid mengde som IKKE havner i produktet.
// Innveid gram = det som står på linjen. Mengden som faktisk er i produktet
// (og som deklarasjonen bygger på) er derfor `grams / (1 + waste/100)`.
// Samme regel gjelder i edge-funksjonene og i klienten.

export { ALLERGEN_LABEL, highlightAllergens } from "./allergen-labels.ts";
import { ALLERGEN_LABEL, highlightAllergens } from "./allergen-labels.ts";
import { computeUnitCount, convertToGrams, resolveFinalWeight } from "./units-recipe.ts";
import { MANDATORY_NUTRIENTS } from "./nutritionFormat.ts";
export { computeUnitCount, resolveFinalWeight };


export const NUT_FIELDS = [
  "energy_kj", "energy_kcal", "fat_g", "saturated_fat_g", "carbs_g", "sugars_g", "fiber_g", "protein_g", "salt_g",
] as const;

export const BRAN_FACTOR: Record<string, number> = {
  wheat_bran: 4.5, rye_bran: 4.0, oat_bran: 2.0,
};

/* ===================== Brødskala'n og Nøkkelhullet =====================
 * BKLF (fellesmerkebestemmelser 03.10.2022):
 *   prosent = (hele korn + kli × faktor + sammalt mel)
 *           / (hele korn + kli + sammalt mel + siktet mel)
 * Kli teller UVEKTET i nevneren og VEKTET i telleren. Gluten og kim regnes som
 * siktet i nevneren. Malt/bakemidler, frø, nøtter, vann, salt, gjær og fett står
 * helt utenfor. Prosenten kan overstige 100 og trykkes under merket (pkt. 4.4).
 *
 * Nøkkelhullet (FOR-2015-02-18-139, Mattilsynets veileder 4.2.1) bruker en helt
 * annen teller: bare hele korn og sammalt mel — KLI TELLER IKKE og har ingen faktor.
 */

export type GrainBucket = "sifted" | "whole" | "bran" | "outside";

/** Én kilde til hvilken bøtte en kornklasse havner i. */
export const GRAIN_BUCKET: Record<string, GrainBucket> = {
  sifted_flour: "sifted",
  other_flour: "sifted",
  gluten_or_germ: "sifted",
  gluten_free_sifted: "sifted",
  whole_grain_flour: "whole",
  whole_grains: "whole",
  gluten_free_grain: "whole",
  gluten_free_whole: "whole",
  wheat_bran: "bran",
  rye_bran: "bran",
  oat_bran: "bran",
  // Utenfor nevneren: malt og bakemidler doserer i promille og er ikke mel.
  malt_or_improver: "outside",
  not_grain: "outside",
};

/** Emmer og einkorn er hvetearter — BKLF regner dem som spelt/hvete. */
export function normalizeCereal(t: string | null | undefined): string | null {
  const v = String(t ?? "").toLowerCase().trim();
  if (!v) return null;
  if (v === "emmer") return "spelt";
  if (v === "einkorn") return "hvete";
  return v;
}

/** Fritekstlinjer med korn-/melord kan ikke klassifiseres og blokkerer merket. */
export const GRAIN_TEXT_RE = /\b(mel|gryn|kli|korn|havre|rug|hvete|spelt|bygg)/i;

/** Fritekstlinjer under denne vekten er for små til å påvirke merket. */
export const GRAIN_TEXT_MIN_GRAMS = 5;

export type BreadscaleEntry = {
  name: string;
  effective_grams: number;
  grain_classification: string | null;
  cereal_type: string | null;
  custom_text?: string | null;
  raw_material_id?: string | null;
};

export type BreadscaleResult = {
  total_flour_grams: number;
  coarse_grams_weighted: number;
  /** BKLF-prosenten, kan overstige 100. Lagres i jsonb til CHECK utvides. */
  breadscale_pct: number | null;
  /** Samme tall som tekst-visning under merket. */
  breadscale_pct_display: string | null;
  /** Verdien som skrives i kolonnen — begrenset til 100 av dagens CHECK. */
  grain_pct: number | null;
  grain_category: string | null;
  /** Nøkkelhullets fullkorn: hele korn + sammalt, UTEN kli og uten faktor. */
  whole_grain_grams: number;
  rye_flour_grams: number;
  contributors: Array<{ name: string; grams: number; classification: string; weighted: number }>;
  unclassified: string[];
  free_text_grain_lines: Array<{ name: string; grams: number }>;
};

export function nbNum(n: number, decimals = 1): string {
  return Number(n).toFixed(decimals).replace(".", ",");
}

/** Brødskala'n og fullkorn-telleren — én implementasjon for edge, klient og tester. */
export function computeBreadscale(entries: BreadscaleEntry[]): BreadscaleResult {
  let denominator = 0;
  let coarseWeighted = 0;
  let wholeGrain = 0;
  let rye = 0;
  const contributors: BreadscaleResult["contributors"] = [];
  const unclassified: string[] = [];
  const free_text_grain_lines: BreadscaleResult["free_text_grain_lines"] = [];

  for (const e of entries) {
    const g = Number(e.effective_grams) || 0;
    const c = e.grain_classification;
    const cereal = normalizeCereal(e.cereal_type);
    const bucket = c ? GRAIN_BUCKET[c] : undefined;

    if (e.custom_text && GRAIN_TEXT_RE.test(e.custom_text) && g > GRAIN_TEXT_MIN_GRAMS) {
      free_text_grain_lines.push({ name: e.custom_text, grams: g });
      continue;
    }
    // Fritekstlinjer uten råvarekobling og uten klassifisering har ikke nødvendigvis
    // fylt ut custom_text — da må selve linjenavnet sjekkes mot kornordene, ellers
    // slipper reelle fritekst-kornlinjer gjennom ukontrollert.
    if (!bucket && !e.raw_material_id && !e.custom_text && GRAIN_TEXT_RE.test(e.name) && g > GRAIN_TEXT_MIN_GRAMS) {
      free_text_grain_lines.push({ name: e.name, grams: g });
      continue;
    }
    if (!bucket) {
      if (g > GRAIN_TEXT_MIN_GRAMS && !e.custom_text) unclassified.push(e.name);
      continue;
    }
    if (bucket === "outside") continue;

    if (bucket === "sifted") {
      denominator += g;
      contributors.push({ name: e.name, grams: g, classification: c!, weighted: 0 });
      if (cereal === "rug") rye += g;
    } else if (bucket === "whole") {
      denominator += g;
      coarseWeighted += g;
      wholeGrain += g;
      contributors.push({ name: e.name, grams: g, classification: c!, weighted: g });
      if (cereal === "rug") rye += g;
    } else {
      // Kli: uvektet i nevneren, vektet i telleren. Aldri fullkorn.
      const w = g * (BRAN_FACTOR[c!] ?? 1);
      denominator += g;
      coarseWeighted += w;
      contributors.push({ name: e.name, grams: g, classification: c!, weighted: w });
      if (cereal === "rug" || c === "rye_bran") rye += g;
    }
  }

  // Rund til én desimal ETT sted — trinnoppslaget bruker samme tall som visningen.
  const pct = denominator > 0 ? Math.round((coarseWeighted / denominator) * 1000) / 10 : null;
  return {
    total_flour_grams: denominator,
    coarse_grams_weighted: coarseWeighted,
    breadscale_pct: pct,
    breadscale_pct_display: pct == null ? null : `${nbNum(pct)} %`,
    grain_pct: pct,
    grain_category: pct == null ? null : breadscaleCategory(pct),
    whole_grain_grams: wholeGrain,
    rye_flour_grams: rye,
    contributors,
    unclassified,
    free_text_grain_lines,
  };
}

/** Flytende fett og sirup holdes utenfor tørrstoffet (veilederen 4.2.1). */
/** Flytende gjær/malt/honning ekskluderes helst via kategori (malt_or_improver) — regex er reservefall for navn uten kobling. */
export const LIQUID_EXCLUDED_RE = /(olje|sirup|flytende fett|flytende gj(æ|ae)r|flytende malt|honning)/i;

export type DryMatterEntry = {
  name: string;
  effective_grams: number;
  water_content_pct: number | null;
  water_content_source?: "override" | "raw_material" | "unknown";
  grain_classification?: string | null;
};

/**
 * Tørrstoff etter Nøkkelhull-veilederen: ukjent vanninnhold ⇒ × 0,85
 * (ikke 0 % vann), kjent vanninnhold ⇒ faktisk tørrstoff, flytende
 * olje/sirup utenfor.
 */
export function dryMatterGrams(entries: DryMatterEntry[]): number {
  let dry = 0;
  for (const e of entries) {
    const g = Number(e.effective_grams) || 0;
    // Malt/bakemidler (ofte flytende) holdes utenfor via kategorien når den er kjent —
    // navnematching (LIQUID_EXCLUDED_RE) er bare reservefall for ukoblede fritekstlinjer.
    if (e.grain_classification === "malt_or_improver") continue;
    if (LIQUID_EXCLUDED_RE.test(e.name ?? "")) continue;
    const known = e.water_content_source ? e.water_content_source !== "unknown" : e.water_content_pct != null;
    dry += known ? g * (1 - (e.water_content_pct ?? 0) / 100) : g * 0.85;
  }
  return dry;
}

/** Fullkornandel av tørrstoff — brukes bare av Nøkkelhullet. */
export function wholeGrainPctOfDry(wholeGrainG: number, dryG: number): number | null {
  if (!(dryG > 0)) return null;
  return Math.round((wholeGrainG / dryG) * 1000) / 10;
}

/**
 * Fullkorn regnet av TØRRSTOFF (Nøkkelhull-veilederen 4.2.1): hver fullkornlinje
 * (whole_grain_flour/whole_grains/gluten_free_grain/gluten_free_whole) telles med
 * sin egen tørrstoffandel — faktisk `water_content_pct` når den finnes, ellers
 * faktoren 0,85. Vannlinjer har 0 g tørrstoff uansett.
 */
export function wholeGrainDryGrams(entries: DryMatterEntry[]): number {
  let dry = 0;
  for (const e of entries) {
    if (isWaterName(e.name)) continue;
    const bucket = e.grain_classification ? GRAIN_BUCKET[e.grain_classification] : undefined;
    if (bucket !== "whole") continue;
    const g = Number(e.effective_grams) || 0;
    const known = e.water_content_source ? e.water_content_source !== "unknown" : e.water_content_pct != null;
    dry += known ? g * (1 - (e.water_content_pct ?? 0) / 100) : g * 0.85;
  }
  return dry;
}

/** Ingredienser som praktisk talt alltid finnes og som ALDRI skal antas å være 0. */
export const CRITICAL_INGREDIENT_RE = /\b(salt|vann|gj(æ|ae)r)\b/i;

/** Linjer over denne andelen av vekten må ha komplett næring før etiketten kan brukes. */
export const CRITICAL_LINE_PCT = 0.25;

/** Matvaretabellen-koden for drikkevann — får automatisk nullrad. */
export const WATER_FOOD_CODE = "13.033";

export function isWaterName(name: string | null | undefined): boolean {
  const n = String(name ?? "").toLowerCase().trim();
  return /^(vann|kaldt vann|varmt vann|isvann|drikkevann)\b/.test(n) || n === "vann";
}

/**
 * Gram-konvertering for deklarasjoner. Bruker den delte enhetsmotoren
 * (units-recipe.ts) slik at oppskriftseditor, PDF og deklarasjon regner likt.
 *
 * Deklarasjonen må alltid ende med en vekt, så volum uten oppgitt tetthet
 * regnes som 1 g/ml — samme antakelse som før. Kallere som kjenner tettheten
 * sender den inn og får et riktigere tall.
 */
export function toGrams(
  qty: number,
  unit: string,
  unitWeightG: number | null,
  densityGPerMl: number | null = 1,
): number {
  return convertToGrams(qty, unit, {
    pieceWeightG: unitWeightG,
    densityGPerMl: densityGPerMl ?? 1,
  }).grams;
}

/**
 * Som `toGrams`, men uten stille antakelser: ukjent enhet og «stk» uten
 * stykkvekt gir `exact: false` med en forklaring i stedet for 0 g.
 */
export function toGramsChecked(
  qty: number,
  unit: string,
  unitWeightG: number | null,
  densityGPerMl: number | null = 1,
): { grams: number; exact: boolean; reason?: string } {
  return convertToGrams(qty, unit, {
    pieceWeightG: unitWeightG,
    densityGPerMl: densityGPerMl ?? 1,
  });
}

/** Mengden som faktisk er i produktet etter ekstra innveid svinn. */
export function gramsAfterWaste(grams: number, wastePercent: number): number {
  const w = Number(wastePercent) || 0;
  return grams / (1 + w / 100);
}


export function normName(s: string): string {
  return s.toLowerCase().trim().replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ");
}

/** Brødskala'n — offisielle terskler: fint <26 %, halvgrovt 26–50,9 %, grovt 51–75,9 %, ekstra grovt ≥76 %. */
export function breadscaleCategory(pct: number): string {
  if (pct < 26) return "fint";
  if (pct < 51) return "halvgrovt";
  if (pct < 76) return "grovt";
  return "ekstra_grovt";
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML med `<strong>` → ren tekst der de samme ordene er markert med `*stjerner*`.
 * Slik overlever uthevingen helt ut til etikett-PDF og nettbutikk.
 */
export function htmlToMarkedText(html: string): string {
  return String(html ?? "")
    .replace(/<strong>(.*?)<\/strong>/gi, "*$1*")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stor forbokstav på første ingrediens — resten røres ikke. */
export function capitalizeFirstIngredient(text: string): string {
  const s = String(text ?? "");
  const m = s.match(/^(\s*(?:<[^>]*>\s*)*)(\p{L})/u);
  if (!m) return s;
  return s.slice(0, m[1].length) + m[2].toUpperCase() + s.slice(m[1].length + m[2].length);
}

export type TopLine = {
  source: "master" | "extra";
  raw_material: any | null;
  raw_material_id: string | null;
  name: string;
  quantity: number;
  unit: string;
  waste_percent: number;
  include: boolean;
  is_quid: boolean;
  custom_text: string | null;
  unit_weight_grams: number | null;
  /** kun oppskriftsvei: linjens overstyring av vanninnhold */
  water_content_pct_override?: number | null;
};

export type FlatLine = {
  source: "master" | "extra";
  key: string;
  raw_material_id: string | null;
  name: string;
  effective_grams: number;
  grams: number;
  is_quid: boolean;
  custom_text: string | null;
  from_composite_parent_id: string | null;
  grain_classification: string | null;
  cereal_type: string | null;
  water_content_pct: number | null;
  water_content_source: "override" | "raw_material" | "unknown";
  allergens: string[];
  may_allergens: string[];
  /** Allergener som kommer fra en sammensatt forelder — vises IKKE i parentes på linjen. */
  inherited_allergens: string[];
  inherited_may_allergens: string[];
  has_nutrition: boolean;
  /** Råvaren næringen skal hentes fra når linjen selv ikke har en rad (tekstkomponent). */
  nutrition_ref: string | null;
};

export type Agg = {
  key: string;
  raw_material_id: string | null;
  name: string;
  effective_grams: number;
  grams: number;
  is_quid: boolean;
  custom_text: string | null;
  grain_classification: string | null;
  cereal_type: string | null;
  water_content_pct: number | null;
  water_content_source: "override" | "raw_material" | "unknown";
  allergens: Set<string>;
  may_allergens: Set<string>;
  inherited_allergens: Set<string>;
  inherited_may_allergens: Set<string>;
  has_nutrition: boolean;
  nutrition_ref: string | null;
  sources: Set<"master" | "extra">;
  parent_ids: Set<string>;
};

export type MissingNutritionLine = {
  raw_material_id: string | null;
  name: string;
  grams: number;
  pct_of_weight: number;
  critical: boolean;
};

export type CoreResult = {
  sortedAgg: Agg[];
  totalInputGrams: number;
  ingredientHtml: string;
  /** Ren tekst med *stjernemarkering* rundt allergenene. */
  ingredientText: string;
  containsList: string[];
  mayContainList: string[];
  /** Rå allergenkoder («gluten_wheat» osv.) bak «Inneholder» — for regelsjekk (f.eks. glutenfritt), ikke visning. */
  containsCodes: string[];
  nutritionTotals: Record<string, number>;
  coveredGrams: number;
  /** Datadekning i % — ÉN kilde til sannheten, brukt av begge edge-funksjonene. */
  coverage_pct: number;
  /** Andel av vekten (%) med data, per obligatorisk næringsfelt. */
  coverage_by_nutrient: Record<string, number>;
  /** Linjer over 0,25 % av vekten uten komplett næring. */
  lines_without_nutrition_over_pct: MissingNutritionLine[];
  /** Alle linjer uten komplett næring, tyngste først. */
  missing_nutrition: MissingNutritionLine[];
  /** Kritiske ingredienser (salt/vann/gjær) uten næringsdata. */
  critical_missing_nutrition: string[];
  /** Råvarer uten en eneste allergenrad — allergener er ikke gjennomgått. */
  missing_allergens: Array<{ raw_material_id: string; name: string; grams: number; pct_of_weight: number }>;
  /** Linjer der enheten ikke kan regnes om til gram. */
  unit_problems: Array<{ name: string; unit: string; reason: string }>;
  /** Fritekstlinjer uten råvarekobling — hard sperre for auto-deklarasjon. */
  free_text_lines: Array<{ name: string; grams: number }>;
  /** Sant bare når alle bidragsytere har fiberverdi. */
  fiber_complete: boolean;
  /** Sammensatte råvarer der komponentprosentene ikke summerer til 100. */
  composite_percent_residual: Array<{ name: string; residual_pct: number }>;
  breadscale: BreadscaleResult;
  rye_flour_grams: number;
  composite_unreviewed: string[];
  composite_text_only: string[];
  /** Råvarer uten declaration_name — innkjøpsnavnet er renset og brukt midlertidig. */
  missing_declaration_names: Array<{ raw_material_id: string; name: string; fallback_used: string }>;
  rmMap: Map<string, any>;
  nutritionByRm: Map<string, any>;
};

/**
 * Tekstkomponenter i en sammensatt råvare har ingen egen næring eller allergener.
 * Forelderens allergener gjelder massen som HELHET — de skal telle med i
 * «Inneholder», men aldri skrives som parentes på delkomponenten. Ellers ble
 * «sukker» til «sukker (melk, soya)» i ingredienslisten.
 */
export function textComponentInheritance(
  parentHasNutrition: boolean,
  parentAllergens: readonly string[],
  parentMayAllergens: readonly string[],
  componentAllergens: readonly string[],
): {
  has_nutrition: boolean;
  allergens: string[];
  may_allergens: string[];
  inherited_allergens: string[];
  inherited_may_allergens: string[];
} {
  const allergens = [...componentAllergens];
  const inherited = parentAllergens.filter((a) => !allergens.includes(a));
  const inheritedMay = parentMayAllergens.filter((a) => !allergens.includes(a) && !inherited.includes(a));
  return {
    has_nutrition: parentHasNutrition,
    allergens,
    may_allergens: [],
    inherited_allergens: inherited,
    inherited_may_allergens: inheritedMay,
  };
}

/** Komplett næring = alle obligatoriske felt er satt. En rad med bare ingredienstekst teller ikke. */
export function nutritionIsComplete(row: any): boolean {
  if (!row) return false;
  return MANDATORY_NUTRIENTS.every((f) => {
    const v = row[f];
    return v != null && Number.isFinite(Number(v));
  });
}

const RM_SELECT = "id, name, declaration_name, is_composite, grain_classification, cereal_type, water_content_pct, components_reviewed_at, unit_weight_grams";

const PACKAGING_RE =
  /(,\s*)?\b(sekk|kartong|container|pose|spann|eske|bøtte|kasse|dunk|flaske|boks|pk|pakke|krt|ctn|bulk|palleboks|kanne|bib|slim|brett|beger|glass|hylse|rull)\b[^,]*/g;
const QUANTITY_RE =
  /(,\s*)?\d+([.,]\d+)?\s*(x\s*\d+([.,]\d+)?\s*)?(kg|g|gr|l|ltr|liter|ml|dl|cl|stk|pk)\b[^,]*/g;
const BRAND_RE =
  /\b(idun|tine|regal|dansk|pals|jæder|jaeder|credin|odense|mills|norgesmøllene|lantmännen|lantmannen|bakers|select|pf|kavli|q-meieriene|synnøve|freia|nidar|callebaut|barry|dreidoppel|zeelandia|puratos|tegral|meny|asko)\b\.?/g;

/**
 * Renser et innkjøpsnavn til et brukbart ingrediensnavn.
 * Speiler SQL-funksjonen public.declaration_name_suggest.
 */
export function suggestDeclarationName(rawName: string): string {
  let t = String(rawName ?? "").toLowerCase();
  t = t.replace(PACKAGING_RE, "");
  t = t.replace(QUANTITY_RE, "");
  t = t.replace(BRAND_RE, "");
  t = t.replace(/\s{2,}/g, " ").replace(/\s*,\s*,/g, ",");
  t = t.replace(/^[\s,\-/]+/, "").replace(/[\s,\-/]+$/, "");
  return t;
}

/**
 * Navnet som skal stå i deklarasjonen for en råvare.
 * declaration_name > renset innkjøpsnavn > fallback. Aldri rått merke-/innkjøpsnavn.
 */
export function declarationNameFor(rm: any, fallbackName: string): string {
  const dn = typeof rm?.declaration_name === "string" ? rm.declaration_name.trim() : "";
  if (dn) return dn;
  const src = rm?.name ?? fallbackName ?? "";
  return suggestDeclarationName(src) || String(src).toLowerCase().trim() || fallbackName;
}

export interface DeclarationOptions {
  /**
   * Ferdigvekt i gram. Er den satt, regnes QUID mot ferdig produkt og
   * vannregelen brukes: vann i ferdig produkt = ferdigvekt − Σ øvrige.
   */
  finalWeightGrams?: number | null;
}

/**
 * Regner ut aggregert deklarasjonsgrunnlag fra topplinjer.
 * `service` må være en Supabase-klient med service-role.
 */
export async function computeDeclarationCore(
  service: any,
  topLines: TopLine[],
  options: DeclarationOptions = {},
): Promise<CoreResult> {
  type Comp = {
    id: string;
    parent_raw_material_id: string;
    component_raw_material_id: string | null;
    primary_ingredient_name: string | null;
    percentage: number;
    sort_order: number;
    allergens: string[] | null;
    is_quid_relevant: boolean;
  };
  const componentsByParent = new Map<string, Comp[]>();

  async function loadComponentsFor(rmIds: string[]) {
    const missing = rmIds.filter((id) => !componentsByParent.has(id));
    if (missing.length === 0) return;
    const { data } = await service
      .from("raw_material_components")
      .select("id, parent_raw_material_id, component_raw_material_id, primary_ingredient_name, percentage, sort_order, allergens, is_quid_relevant")
      .in("parent_raw_material_id", missing);
    for (const id of missing) componentsByParent.set(id, []);
    for (const c of data ?? []) {
      const arr = componentsByParent.get(c.parent_raw_material_id) ?? [];
      arr.push(c as Comp);
      componentsByParent.set(c.parent_raw_material_id, arr);
    }
  }

  const initialCompositeIds = topLines
    .filter((t) => t.raw_material?.is_composite && t.raw_material_id)
    .map((t) => t.raw_material_id as string);
  await loadComponentsFor(initialCompositeIds);

  const composite_unreviewed: string[] = [];
  const composite_text_only: string[] = [];
  const composite_percent_residual: Array<{ name: string; residual_pct: number }> = [];
  const unit_problems: Array<{ name: string; unit: string; reason: string }> = [];
  const missingDeclMap = new Map<string, { raw_material_id: string; name: string; fallback_used: string }>();

  const collectedRmIds = new Set<string>();
  function collectFromComponents(rmId: string) {
    for (const c of componentsByParent.get(rmId) ?? []) {
      if (c.component_raw_material_id) collectedRmIds.add(c.component_raw_material_id);
    }
  }
  for (const t of topLines) {
    if (t.raw_material_id) collectedRmIds.add(t.raw_material_id);
    if (t.raw_material?.is_composite && t.raw_material_id) collectFromComponents(t.raw_material_id);
  }

  // Nivå 2
  const level2Ids: string[] = [];
  for (const id of collectedRmIds) if (componentsByParent.get(id) === undefined) level2Ids.push(id);
  if (level2Ids.length) {
    const { data: l2 } = await service.from("raw_materials").select("id, is_composite").in("id", level2Ids);
    const compositeChildIds = (l2 ?? []).filter((r: any) => r.is_composite).map((r: any) => r.id);
    if (compositeChildIds.length) {
      await loadComponentsFor(compositeChildIds);
      for (const id of compositeChildIds) collectFromComponents(id);
    }
  }

  const allRmIds = [...collectedRmIds];
  const [rmRes, nutritionRes, allergenRes] = await Promise.all([
    allRmIds.length ? service.from("raw_materials").select(RM_SELECT).in("id", allRmIds) : { data: [] },
    allRmIds.length ? service.from("raw_material_nutrition").select("*").in("raw_material_id", allRmIds) : { data: [] },
    allRmIds.length ? service.from("raw_material_allergens").select("raw_material_id, allergen, presence").in("raw_material_id", allRmIds) : { data: [] },
  ]);
  const rmMap = new Map<string, any>();
  for (const r of (rmRes as any).data ?? []) rmMap.set(r.id, r);
  const nutritionByRm = new Map<string, any>();
  for (const n of (nutritionRes as any).data ?? []) nutritionByRm.set(n.raw_material_id, n);
  const allergensByRm = new Map<string, { allergen: string; presence: string }[]>();
  for (const a of (allergenRes as any).data ?? []) {
    const arr = allergensByRm.get(a.raw_material_id) ?? [];
    arr.push({ allergen: a.allergen, presence: a.presence });
    allergensByRm.set(a.raw_material_id, arr);
  }

  /** Nullrad for vann: vann har ingen næring, men skal telle som DEKKET — ikke som hull. */
  const ZERO_NUTRITION: Record<string, number> = Object.fromEntries(NUT_FIELDS.map((f) => [f, 0]));

  function isWaterRow(rmId: string | null, name: string): boolean {
    if (isWaterName(name)) return true;
    if (!rmId) return false;
    const rm = rmMap.get(rmId);
    if (isWaterName(rm?.name) || isWaterName(rm?.declaration_name)) return true;
    const n = nutritionByRm.get(rmId);
    const code = n?.matvaretabellen_food_id ?? n?.source_food_id ?? n?.source_code ?? null;
    return code != null && String(code) === WATER_FOOD_CODE;
  }

  /** Næringsraden som gjelder for en aggregert linje — vann får automatisk nullrad. */
  function nutritionRowFor(rmId: string | null, nutritionRef: string | null, name: string): any | null {
    const direct = rmId ? nutritionByRm.get(rmId) : null;
    if (nutritionIsComplete(direct)) return direct;
    const ref = nutritionRef ? nutritionByRm.get(nutritionRef) : null;
    if (nutritionIsComplete(ref)) return ref;
    if (isWaterRow(rmId, name)) return ZERO_NUTRITION;
    return direct ?? ref ?? null;
  }

  function hasCompleteNutrition(rmId: string | null, name: string): boolean {
    if (isWaterRow(rmId, name)) return true;
    return rmId ? nutritionIsComplete(nutritionByRm.get(rmId)) : false;
  }

  function waterFor(rm: any, override: number | null | undefined): { pct: number | null; source: FlatLine["water_content_source"] } {
    if (override != null && Number.isFinite(Number(override))) return { pct: Number(override), source: "override" };
    const v = rm?.water_content_pct;
    if (v != null && Number.isFinite(Number(v))) return { pct: Number(v), source: "raw_material" };
    return { pct: null, source: "unknown" };
  }

  function allergensOf(rmId: string | null): { contains: string[]; may: string[] } {
    const rows = rmId ? allergensByRm.get(rmId) ?? [] : [];
    return {
      contains: rows.filter((a) => a.presence === "contains").map((a) => a.allergen),
      may: rows.filter((a) => a.presence === "may_contain").map((a) => a.allergen),
    };
  }

  function decompose(
    source: "master" | "extra",
    grams: number,
    effective_grams: number,
    rmId: string | null,
    fallbackName: string,
    isQuid: boolean,
    customText: string | null,
    depth: number,
    parentChain: string | null,
    waterOverride: number | null | undefined,
    parentNutritionRef: string | null = null,
  ): FlatLine[] {
    const rm = rmId ? rmMap.get(rmId) ?? null : null;
    // Sammensatt bare når komponentene faktisk peker på egne råvarer. Er de bare
    // tekst fra et datablad, bruker vi forelderens egen nærings- og allergenrad.
    const ownComponents = rmId ? componentsByParent.get(rmId) ?? [] : [];
    const hasLinkedComponents = ownComponents.some((c) => !!c.component_raw_material_id);
    const isComposite = !!rm?.is_composite && depth < 3 && hasLinkedComponents;
    if (!isComposite) {
      const al = allergensOf(rmId);
      const declName = declarationNameFor(rm, fallbackName);
      // Samme råvare kan stå både som egen linje og inne i en parentes —
      // derfor tas forelderen med i nøkkelen.
      const base = rmId ? `rm:${rmId}` : `text:${normName(fallbackName)}`;
      const key = parentChain ? `${base}@${parentChain}` : base;
      const w = waterFor(rm, depth === 0 ? waterOverride : null);
      const hasDeclName = typeof rm?.declaration_name === "string" && rm.declaration_name.trim() !== "";
      if (rmId && rm && !hasDeclName && !missingDeclMap.has(rmId)) {
        missingDeclMap.set(rmId, { raw_material_id: rmId, name: rm.name ?? fallbackName, fallback_used: declName });
      }
      return [{
        source,
        key,
        raw_material_id: rmId,
        name: declName,
        grams,
        effective_grams,
        is_quid: isQuid,
        custom_text: customText,
        from_composite_parent_id: parentChain,
        grain_classification: rm?.grain_classification ?? null,
        cereal_type: rm?.cereal_type ?? null,
        water_content_pct: w.pct,
        water_content_source: w.source,
        allergens: al.contains,
        may_allergens: al.may,
        inherited_allergens: [],
        inherited_may_allergens: [],
        has_nutrition: hasCompleteNutrition(rmId, declName),
        // En koblet komponent uten egen næringsrad arver forelderens næringsrad
        // (parentNutritionRef) i stedet for å telle som et hull i dekningen.
        nutrition_ref: hasCompleteNutrition(rmId, declName) ? null : parentNutritionRef,
      }];
    }
    if (rmId && !rm?.components_reviewed_at) {
      const nm = rm?.name ?? rmId;
      if (!composite_unreviewed.includes(nm)) composite_unreviewed.push(nm);
    }
    const parentComplete = rmId ? nutritionIsComplete(nutritionByRm.get(rmId)) : false;
    const parentAl = allergensOf(rmId);
    const comps = (componentsByParent.get(rmId!) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
    const out: FlatLine[] = [];
    const sumPct = comps.reduce((s, c) => s + (Number(c.percentage) || 0), 0);
    // Summerer ikke komponentene til 100 %, blir resten en synlig «(øvrige)»-post
    // i stedet for at alt normaliseres stille opp.
    const residual = Math.round((100 - sumPct) * 100) / 100;
    const totalPct = sumPct > 0 ? Math.max(sumPct, 100) : 100;
    if (Math.abs(residual) >= 0.5) {
      const nm = rm?.name ?? rmId ?? "Sammensatt";
      if (!composite_percent_residual.some((r) => r.name === nm)) {
        composite_percent_residual.push({ name: nm, residual_pct: residual });
      }
    }
    for (const c of comps) {
      const ratio = (Number(c.percentage) || 0) / totalPct;
      const childGrams = grams * ratio;
      const childEff = effective_grams * ratio;
      if (c.component_raw_material_id) {
        out.push(...decompose(source, childGrams, childEff, c.component_raw_material_id, "(komponent)", c.is_quid_relevant || isQuid, null, depth + 1, rmId, null, rmId));
      } else {
        const nm = c.primary_ingredient_name ?? "(komponent)";
        // Tekstkomponenten har ingen egen næring eller allergener. Forelderens rad
        // gjelder hele massen, så andelen her dekkes forholdsmessig av den.
        const inherited = textComponentInheritance(
          parentComplete,
          parentAl.contains,
          parentAl.may,
          c.allergens ?? [],
        );
        if (!composite_text_only.includes(nm)) composite_text_only.push(nm);
        out.push({
          source,
          key: `text:${normName(nm)}@${rmId}`,
          raw_material_id: null,
          name: nm,
          grams: childGrams,
          effective_grams: childEff,
          is_quid: c.is_quid_relevant || isQuid,
          custom_text: null,
          from_composite_parent_id: rmId,
          grain_classification: null,
          cereal_type: null,
          water_content_pct: null,
          water_content_source: "unknown",
          allergens: inherited.allergens,
          may_allergens: inherited.may_allergens,
          inherited_allergens: inherited.inherited_allergens,
          inherited_may_allergens: inherited.inherited_may_allergens,
          has_nutrition: inherited.has_nutrition,
          // Næringen ligger på forelderen; andelen her dekkes forholdsmessig.
          nutrition_ref: rmId,
        });
      }
    }
    if (Math.abs(residual) >= 0.5 && residual > 0) {
      const ratio = residual / totalPct;
      out.push({
        source,
        key: `text:øvrige@${rmId}`,
        raw_material_id: null,
        name: "(øvrige)",
        grams: grams * ratio,
        effective_grams: effective_grams * ratio,
        is_quid: false,
        custom_text: null,
        from_composite_parent_id: rmId,
        grain_classification: null,
        cereal_type: null,
        water_content_pct: null,
        water_content_source: "unknown",
        allergens: [],
        may_allergens: [],
        inherited_allergens: parentAl.contains,
        inherited_may_allergens: parentAl.may,
        has_nutrition: parentComplete,
        nutrition_ref: rmId,
      });
    }
    return out;
  }

  // Allergener fra linjer som er tatt UT av ingredienslisten. De skal fortsatt
  // stå i «Inneholder» — art. 21 gjelder uansett om ingrediensen listes eller ei.
  const allergenOnlyContains = new Set<string>();
  const allergenOnlyMay = new Set<string>();
  const free_text_lines: Array<{ name: string; grams: number }> = [];

  const flatLines: FlatLine[] = [];
  for (const t of topLines) {
    const conv = toGramsChecked(t.quantity, t.unit, t.unit_weight_grams);
    if (!conv.exact && (Number(t.quantity) || 0) > 0) {
      unit_problems.push({ name: t.name, unit: t.unit, reason: conv.reason ?? "ukjent omregning" });
    }
    const grams = conv.grams;
    const effective = gramsAfterWaste(grams, t.waste_percent);

    if (!t.include) {
      const al = allergensOf(t.raw_material_id);
      for (const a of al.contains) allergenOnlyContains.add(a);
      for (const a of al.may) allergenOnlyMay.add(a);
      continue;
    }

    if (t.custom_text) {
      const rm = t.raw_material_id ? rmMap.get(t.raw_material_id) : null;
      const w = waterFor(rm, t.water_content_pct_override);
      // Fritekstlinjen beholder råvarens allergener når den er koblet.
      const al = allergensOf(t.raw_material_id);
      if (!t.raw_material_id) free_text_lines.push({ name: t.custom_text, grams: effective });
      flatLines.push({
        source: t.source, key: `text:${normName(t.custom_text)}`,
        raw_material_id: t.raw_material_id, name: t.name,
        grams, effective_grams: effective,
        is_quid: t.is_quid, custom_text: t.custom_text,
        from_composite_parent_id: null,
        grain_classification: rm?.grain_classification ?? t.raw_material?.grain_classification ?? null,
        cereal_type: rm?.cereal_type ?? null,
        water_content_pct: w.pct, water_content_source: w.source,
        allergens: al.contains, may_allergens: al.may,
        inherited_allergens: [], inherited_may_allergens: [],
        nutrition_ref: null,
        has_nutrition: hasCompleteNutrition(t.raw_material_id, t.custom_text),
      });
      continue;
    }
    if (!t.raw_material_id) free_text_lines.push({ name: t.name, grams: effective });
    flatLines.push(...decompose(t.source, grams, effective, t.raw_material_id, t.name, t.is_quid, null, 0, null, t.water_content_pct_override));
  }

  // Aggregér
  const aggMap = new Map<string, Agg>();
  for (const l of flatLines) {
    const ex = aggMap.get(l.key);
    if (ex) {
      ex.effective_grams += l.effective_grams;
      ex.grams += l.grams;
      ex.is_quid = ex.is_quid || l.is_quid;
      for (const a of l.allergens) ex.allergens.add(a);
      for (const a of l.may_allergens) ex.may_allergens.add(a);
      for (const a of l.inherited_allergens) ex.inherited_allergens.add(a);
      for (const a of l.inherited_may_allergens) ex.inherited_may_allergens.add(a);
      if (!ex.nutrition_ref && l.nutrition_ref) ex.nutrition_ref = l.nutrition_ref;
      ex.sources.add(l.source);
      if (l.from_composite_parent_id) ex.parent_ids.add(l.from_composite_parent_id);
      if (ex.water_content_source === "unknown" && l.water_content_source !== "unknown") {
        ex.water_content_pct = l.water_content_pct;
        ex.water_content_source = l.water_content_source;
      }
    } else {
      aggMap.set(l.key, {
        key: l.key, raw_material_id: l.raw_material_id, name: l.name,
        effective_grams: l.effective_grams, grams: l.grams, is_quid: l.is_quid, custom_text: l.custom_text,
        grain_classification: l.grain_classification,
        cereal_type: l.cereal_type,
        water_content_pct: l.water_content_pct,
        water_content_source: l.water_content_source,
        allergens: new Set(l.allergens), may_allergens: new Set(l.may_allergens),
        inherited_allergens: new Set(l.inherited_allergens),
        inherited_may_allergens: new Set(l.inherited_may_allergens),
        nutrition_ref: l.nutrition_ref,
        has_nutrition: l.has_nutrition, sources: new Set([l.source]),
        parent_ids: new Set(l.from_composite_parent_id ? [l.from_composite_parent_id] : []),
      });
    }
  }

  const totalInputGrams = [...aggMap.values()].reduce((s, l) => s + l.effective_grams, 0) || 1;

  /**
   * Vannregelen (vedlegg VII del A punkt 6): vann skal oppgis med mengden det
   * utgjør i det FERDIGE produktet, og utelates når det er ≤ 5 %.
   */
  const finalWeight = Number(options.finalWeightGrams) || 0;
  if (finalWeight > 0) {
    const waterKeys = [...aggMap.values()].filter((a) => isWaterRow(a.raw_material_id, a.name)).map((a) => a.key);
    if (waterKeys.length) {
      const others = [...aggMap.values()]
        .filter((a) => !waterKeys.includes(a.key))
        .reduce((s, a) => s + a.effective_grams, 0);
      const waterInProduct = finalWeight - others;
      // Alt vannet samles på den første vannlinjen.
      const [firstKey, ...restKeys] = waterKeys;
      for (const k of restKeys) aggMap.delete(k);
      const first = aggMap.get(firstKey)!;
      if (waterInProduct <= finalWeight * 0.05 || waterInProduct <= 0) {
        aggMap.delete(firstKey);
      } else {
        first.effective_grams = waterInProduct;
        first.grams = waterInProduct;
      }
    }
  }

  const quidBase = finalWeight > 0 ? finalWeight : totalInputGrams;
  const sortedAgg = [...aggMap.values()].sort((a, b) => b.effective_grams - a.effective_grams);

  // Wrap sammensatte råvarer i deklarasjonen
  const parentToChildren = new Map<string, Agg[]>();
  for (const a of sortedAgg) {
    if (a.parent_ids.size === 1) {
      const pid = [...a.parent_ids][0];
      const arr = parentToChildren.get(pid) ?? [];
      arr.push(a);
      parentToChildren.set(pid, arr);
    }
  }
  const wrapParents = new Set<string>();
  const parentWeight = new Map<string, number>();
  for (const [pid, kids] of parentToChildren.entries()) {
    if (kids.length > 0 && kids.every((k) => k.parent_ids.size === 1)) {
      wrapParents.add(pid);
      parentWeight.set(pid, kids.reduce((s, k) => s + k.effective_grams, 0));
    }
  }

  function renderItem(a: Agg, includeQuid: boolean): string {
    // Fritekst skal også få allergenene sine uthevet — art. 21 gjelder teksten.
    if (a.custom_text) return highlightAllergens(escapeHtml(a.custom_text), [...a.allergens]);
    // Alle allergener uthevet; de som ikke står i navnet legges til i parentes.
    let display = highlightAllergens(escapeHtml(a.name), [...a.allergens]);
    if (includeQuid && a.is_quid) {
      const pct = Math.round((a.effective_grams / quidBase) * 1000) / 10;
      if (pct > 100) {
        // Mer enn 100 g per 100 g ferdig produkt (vann fordampet) — da kreves «g per 100 g».
        const gPer100 = Math.round((a.effective_grams / quidBase) * 1000) / 10;
        display += ` (${String(gPer100).replace(".", ",")} g per 100 g)`;
      } else {
        // QUID vises i parentes med norsk desimalkomma: «(12,5 %)».
        display += ` (${String(pct).replace(".", ",")} %)`;
      }
    }

    return display;
  }

  // Sammensatte råvarer plasseres etter SAMLET vekt, ikke etter tyngste komponent.
  type Entry = { weight: number; render: () => string; keys: string[] };
  const entries: Entry[] = [];
  const handledParents = new Set<string>();
  for (const a of sortedAgg) {
    if (a.parent_ids.size === 1) {
      const pid = [...a.parent_ids][0];
      if (wrapParents.has(pid)) {
        if (handledParents.has(pid)) continue;
        handledParents.add(pid);
        const parentRm = rmMap.get(pid) ?? null;
        const parentName = declarationNameFor(parentRm, "Sammensatt");
        const parentHasDeclName = typeof parentRm?.declaration_name === "string" && parentRm.declaration_name.trim() !== "";
        if (parentRm && !parentHasDeclName && !missingDeclMap.has(pid)) {
          missingDeclMap.set(pid, { raw_material_id: pid, name: parentRm.name ?? "Sammensatt", fallback_used: parentName });
        }
        const kids = (parentToChildren.get(pid) ?? []).slice().sort((x, y) => y.effective_grams - x.effective_grams);
        // Forelderens egne allergener uthevet på FORELDER-nivå. Parentesen med
        // allergenet som ikke står i navnet skal stå BAK komponentlisten, ikke
        // rett etter forelderens navn — highlightAllergens legger den til på
        // slutten av strengen den får inn, så vi kjører den på navnet ALENE og
        // flytter en eventuell tilføyd parentes til slutten.
        const parentAllergens = allergensOf(pid).contains;
        entries.push({
          weight: parentWeight.get(pid) ?? 0,
          keys: kids.map((k) => k.key),
          render: () => {
            const nameHighlighted = highlightAllergens(escapeHtml(parentName), parentAllergens);
            const kidsPart = `(${kids.map((k) => renderItem(k, false)).join(", ")})`;
            const appended = nameHighlighted.match(/^([\s\S]*?)( \([\s\S]*\))$/);
            if (appended) return `${appended[1]} ${kidsPart}${appended[2]}`;
            return `${nameHighlighted} ${kidsPart}`;
          },
        });
        continue;
      }
    }
    entries.push({ weight: a.effective_grams, keys: [a.key], render: () => renderItem(a, true) });
  }
  entries.sort((x, y) => y.weight - x.weight);
  const ingredientHtml = capitalizeFirstIngredient(entries.map((e) => e.render()).join(", "));
  const ingredientText = capitalizeFirstIngredient(htmlToMarkedText(ingredientHtml));

  const allergenSet = new Set<string>(allergenOnlyContains);
  const mayContainSet = new Set<string>();
  for (const a of sortedAgg) {
    for (const al of a.allergens) allergenSet.add(al);
    // Arvede allergener teller i «Inneholder», men står ikke i parentes på linjen.
    for (const al of a.inherited_allergens) allergenSet.add(al);
  }
  for (const a of sortedAgg) {
    for (const al of a.may_allergens) if (!allergenSet.has(al)) mayContainSet.add(al);
    for (const al of a.inherited_may_allergens) if (!allergenSet.has(al)) mayContainSet.add(al);
  }
  for (const al of allergenOnlyMay) if (!allergenSet.has(al)) mayContainSet.add(al);
  const containsCodes = [...allergenSet].sort();
  const containsList = [...allergenSet].map((a) => ALLERGEN_LABEL[a] ?? a).sort();
  const mayContainList = [...mayContainSet].map((a) => ALLERGEN_LABEL[a] ?? a).sort();

  // Næring — totalsummer (ikke delt på vekt ennå)
  const nutritionTotals: Record<string, number> = {};
  const coveredByField: Record<string, number> = Object.fromEntries(NUT_FIELDS.map((f) => [f, 0]));
  let coveredGrams = 0;
  let fiberComplete = true;
  const missing_nutrition: MissingNutritionLine[] = [];
  const totalForCoverage = sortedAgg.reduce((s, a) => s + a.effective_grams, 0) || totalInputGrams;

  for (const a of sortedAgg) {
    const n = nutritionRowFor(a.raw_material_id, a.nutrition_ref, a.name);
    const complete = nutritionIsComplete(n) || (n === ZERO_NUTRITION);
    if (complete) coveredGrams += a.effective_grams;
    else {
      const pct = Math.round((a.effective_grams / totalForCoverage) * 10000) / 100;
      missing_nutrition.push({
        raw_material_id: a.raw_material_id,
        name: a.name,
        grams: Math.round(a.effective_grams * 10) / 10,
        pct_of_weight: pct,
        critical: CRITICAL_INGREDIENT_RE.test(a.name),
      });
    }
    if (!n) {
      fiberComplete = false;
      continue;
    }
    if (n.fiber_g == null || !Number.isFinite(Number(n.fiber_g))) fiberComplete = false;
    for (const f of NUT_FIELDS) {
      const v = Number(n[f]);
      if (n[f] != null && Number.isFinite(v)) {
        nutritionTotals[f] = (nutritionTotals[f] ?? 0) + (v * a.effective_grams) / 100;
        coveredByField[f] += a.effective_grams;
      }
    }
  }
  missing_nutrition.sort((x, y) => y.grams - x.grams);

  // Allergener: en råvare uten rader i raw_material_allergens er ikke gjennomgått.
  const missing_allergens: Array<{ raw_material_id: string; name: string; grams: number; pct_of_weight: number }> = [];
  const seenAllergenRm = new Set<string>();
  for (const a of sortedAgg) {
    const rmId = a.raw_material_id;
    if (!rmId || seenAllergenRm.has(rmId)) continue;
    seenAllergenRm.add(rmId);
    if ((allergensByRm.get(rmId) ?? []).length > 0) continue;
    if (isWaterRow(rmId, a.name)) continue;
    missing_allergens.push({
      raw_material_id: rmId,
      name: a.name,
      grams: Math.round(a.effective_grams * 10) / 10,
      pct_of_weight: Math.round((a.effective_grams / totalForCoverage) * 10000) / 100,
    });
  }
  missing_allergens.sort((x, y) => y.grams - x.grams);

  const coverage_by_nutrient: Record<string, number> = {};
  for (const f of NUT_FIELDS) {
    coverage_by_nutrient[f] = Math.round((coveredByField[f] / totalForCoverage) * 1000) / 10;
  }
  // Dekningsprosent — ÉN definisjon: teller og nevner er begge etter vannregelen
  // (samme sortedAgg-sum). Før dette ble dekket vekt talt ETTER vannregelen mens
  // nevneren var innveid vekt FØR den — det ga feil prosent når vannregelen slo inn.
  const coverage_pct = totalForCoverage > 0 ? Math.round((coveredGrams / totalForCoverage) * 1000) / 10 : 0;

  const lines_without_nutrition_over_pct = missing_nutrition.filter((m) => m.pct_of_weight > CRITICAL_LINE_PCT);
  const critical_missing_nutrition = missing_nutrition.filter((m) => m.critical).map((m) => m.name);

  // Brødskala'n og Nøkkelhullets fullkornteller — felles motor.
  const breadscale = computeBreadscale(sortedAgg);

  return {
    sortedAgg,
    totalInputGrams,
    ingredientHtml,
    ingredientText,
    containsList,
    mayContainList,
    containsCodes,
    nutritionTotals,
    coveredGrams,
    coverage_pct,
    coverage_by_nutrient,
    lines_without_nutrition_over_pct,
    missing_nutrition,
    missing_allergens,
    critical_missing_nutrition,
    unit_problems,
    free_text_lines,
    fiber_complete: fiberComplete,
    composite_percent_residual,
    breadscale,
    rye_flour_grams: breadscale.rye_flour_grams,
    composite_unreviewed,
    composite_text_only,
    missing_declaration_names: [...missingDeclMap.values()],
    rmMap,
    nutritionByRm,
  };
}

export type DeclarationGate = {
  blocked: boolean;
  reasons: string[];
};

/**
 * Felles sperre for auto-deklarasjon. Samme regel i oppskrift- og produktveien:
 * under 90 % vektdekning, en linje over 0,25 % uten næring, en kritisk ingrediens
 * uten næring, en ukjent enhet eller en fritekstlinje ⇒ etiketten kan ikke brukes.
 */
export function declarationGate(core: CoreResult, coveragePct: number): DeclarationGate {
  const reasons: string[] = [];
  if (coveragePct < 90) reasons.push(`Kun ${String(Math.round(coveragePct * 10) / 10).replace(".", ",")} % av vekten har næringsdata`);
  for (const c of core.critical_missing_nutrition) reasons.push(`${c} mangler næringsdata`);
  for (const l of core.lines_without_nutrition_over_pct) {
    if (core.critical_missing_nutrition.includes(l.name)) continue;
    reasons.push(`${l.name} mangler næringsdata (${String(l.pct_of_weight).replace(".", ",")} % av vekten)`);
  }
  for (const u of core.unit_problems) reasons.push(`${u.name}: ${u.reason}`);
  for (const t of core.free_text_lines) reasons.push(`Fritekstlinjen «${t.name}» må kobles til en råvare`);
  // Manglende deklarasjonsnavn sperrer ikke i seg selv (innkjøpsnavnet brukes midlertidig),
  // men skal synes som en tydelig oppfordring med forslaget kjernen allerede har regnet ut.
  for (const d of core.missing_declaration_names) {
    reasons.push(`${d.name} mangler deklarasjonsnavn – forslag: ${d.fallback_used}`);
  }
  return { blocked: reasons.length > 0, reasons };
}
