// Delt kjerne for deklarasjonsberegning.
// Brukes av compute-product-declaration (produkt-kobling) og compute-recipe-label (oppskrift).
// Håndterer: gram-konvertering, svinn, rekursiv dekomponering av sammensatte råvarer,
// aggregering, QUID, allergener, næring og Brødskala'n.

export { ALLERGEN_LABEL, highlightAllergens } from "./allergen-labels.ts";
import { ALLERGEN_LABEL, highlightAllergens } from "./allergen-labels.ts";

export const NUT_FIELDS = [
  "energy_kj", "energy_kcal", "fat_g", "saturated_fat_g", "carbs_g", "sugars_g", "fiber_g", "protein_g", "salt_g",
] as const;

export const BRAN_FACTOR: Record<string, number> = {
  wheat_bran: 4.5, rye_bran: 4.0, oat_bran: 2.0,
};

export function toGrams(qty: number, unit: string, unitWeightG: number | null): number {
  const u = (unit || "").toLowerCase();
  if (u === "g") return qty;
  if (u === "kg") return qty * 1000;
  if (u === "ml") return qty;
  if (u === "cl") return qty * 10;
  if (u === "dl") return qty * 100;
  if (u === "l" || u === "liter") return qty * 1000;
  if (u === "stk") return qty * (unitWeightG ?? 0);
  return 0;
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
  has_nutrition: boolean;
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
  has_nutrition: boolean;
  sources: Set<"master" | "extra">;
  parent_ids: Set<string>;
};

export type CoreResult = {
  sortedAgg: Agg[];
  totalInputGrams: number;
  ingredientHtml: string;
  containsList: string[];
  mayContainList: string[];
  nutritionTotals: Record<string, number>;
  coveredGrams: number;
  breadscale: {
    total_flour_grams: number;
    coarse_grams_weighted: number;
    grain_pct: number | null;
    grain_category: string | null;
    contributors: Array<{ name: string; grams: number; classification: string; weighted: number }>;
    unclassified: string[];
  };
  rye_flour_grams: number;
  composite_unreviewed: string[];
  composite_text_only: string[];
  /** Råvarer uten declaration_name — innkjøpsnavnet er renset og brukt midlertidig. */
  missing_declaration_names: Array<{ raw_material_id: string; name: string; fallback_used: string }>;
  rmMap: Map<string, any>;
  nutritionByRm: Map<string, any>;
};

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

/**
 * Regner ut aggregert deklarasjonsgrunnlag fra topplinjer.
 * `service` må være en Supabase-klient med service-role.
 */
export async function computeDeclarationCore(service: any, topLines: TopLine[]): Promise<CoreResult> {
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

  function waterFor(rm: any, override: number | null | undefined): { pct: number | null; source: FlatLine["water_content_source"] } {
    if (override != null && Number.isFinite(Number(override))) return { pct: Number(override), source: "override" };
    const v = rm?.water_content_pct;
    if (v != null && Number.isFinite(Number(v))) return { pct: Number(v), source: "raw_material" };
    return { pct: null, source: "unknown" };
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
  ): FlatLine[] {
    const rm = rmId ? rmMap.get(rmId) ?? null : null;
    // Sammensatt bare når komponentene faktisk peker på egne råvarer. Er de bare
    // tekst fra et datablad, bruker vi forelderens egen nærings- og allergenrad.
    const ownComponents = rmId ? componentsByParent.get(rmId) ?? [] : [];
    const hasLinkedComponents = ownComponents.some((c) => !!c.component_raw_material_id);
    const isComposite = !!rm?.is_composite && depth < 3 && hasLinkedComponents;
    if (!isComposite) {
      const allergens = rmId ? (allergensByRm.get(rmId) ?? []).filter((a) => a.presence === "contains").map((a) => a.allergen) : [];
      const may = rmId ? (allergensByRm.get(rmId) ?? []).filter((a) => a.presence === "may_contain").map((a) => a.allergen) : [];
      const key = rmId ? `rm:${rmId}` : `text:${normName(fallbackName)}`;
      const w = waterFor(rm, depth === 0 ? waterOverride : null);
      const declName = declarationNameFor(rm, fallbackName);
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
        allergens,
        may_allergens: may,
        has_nutrition: rmId ? !!nutritionByRm.get(rmId) : false,
      }];
    }
    if (rmId && !rm?.components_reviewed_at) {
      const nm = rm?.name ?? rmId;
      if (!composite_unreviewed.includes(nm)) composite_unreviewed.push(nm);
    }
    const comps = (componentsByParent.get(rmId!) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
    const out: FlatLine[] = [];
    const totalPct = comps.reduce((s, c) => s + Number(c.percentage), 0) || 100;
    for (const c of comps) {
      const ratio = Number(c.percentage) / totalPct;
      const childGrams = grams * ratio;
      const childEff = effective_grams * ratio;
      if (c.component_raw_material_id) {
        out.push(...decompose(source, childGrams, childEff, c.component_raw_material_id, "(komponent)", c.is_quid_relevant || isQuid, null, depth + 1, rmId, null));
      } else {
        const nm = c.primary_ingredient_name ?? "(komponent)";
        if (!composite_text_only.includes(nm)) composite_text_only.push(nm);
        out.push({
          source,
          key: `text:${normName(nm)}`,
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
          allergens: c.allergens ?? [],
          may_allergens: [],
          has_nutrition: false,
        });
      }
    }
    return out;
  }

  const flatLines: FlatLine[] = [];
  for (const t of topLines) {
    if (!t.include) continue;
    const grams = toGrams(t.quantity, t.unit, t.unit_weight_grams);
    const effective = grams * (1 - t.waste_percent / 100);
    if (t.custom_text) {
      const rm = t.raw_material_id ? rmMap.get(t.raw_material_id) : null;
      const w = waterFor(rm, t.water_content_pct_override);
      flatLines.push({
        source: t.source, key: `text:${normName(t.custom_text)}`,
        raw_material_id: t.raw_material_id, name: t.name,
        grams, effective_grams: effective,
        is_quid: t.is_quid, custom_text: t.custom_text,
        from_composite_parent_id: null,
        grain_classification: rm?.grain_classification ?? t.raw_material?.grain_classification ?? null,
        cereal_type: rm?.cereal_type ?? null,
        water_content_pct: w.pct, water_content_source: w.source,
        allergens: [], may_allergens: [],
        has_nutrition: t.raw_material_id ? !!nutritionByRm.get(t.raw_material_id) : false,
      });
      continue;
    }
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
        has_nutrition: l.has_nutrition, sources: new Set([l.source]),
        parent_ids: new Set(l.from_composite_parent_id ? [l.from_composite_parent_id] : []),
      });
    }
  }

  const totalInputGrams = [...aggMap.values()].reduce((s, l) => s + l.effective_grams, 0) || 1;
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
  for (const [pid, kids] of parentToChildren.entries()) {
    if (kids.length > 0 && kids.every((k) => k.parent_ids.size === 1)) wrapParents.add(pid);
  }

  function renderItem(a: Agg, includeQuid: boolean): string {
    if (a.custom_text) return escapeHtml(a.custom_text);
    // Alle allergener uthevet; de som ikke står i navnet legges til i parentes.
    let display = highlightAllergens(escapeHtml(a.name), a.allergens);
    if (includeQuid && a.is_quid) {
      const pct = Math.round((a.effective_grams / totalInputGrams) * 1000) / 10;
      // QUID vises i parentes med norsk desimalkomma: «(12,5 %)».
      display += ` (${String(pct).replace(".", ",")} %)`;
    }

    return display;
  }

  const renderedKeys = new Set<string>();
  const ingredientParts: string[] = [];
  const parentFirstPos = new Map<string, number>();
  sortedAgg.forEach((a, i) => {
    if (a.parent_ids.size === 1) {
      const pid = [...a.parent_ids][0];
      if (wrapParents.has(pid) && !parentFirstPos.has(pid)) parentFirstPos.set(pid, i);
    }
  });
  for (let i = 0; i < sortedAgg.length; i++) {
    const a = sortedAgg[i];
    if (renderedKeys.has(a.key)) continue;
    let wrapped = false;
    if (a.parent_ids.size === 1) {
      const pid = [...a.parent_ids][0];
      if (wrapParents.has(pid) && parentFirstPos.get(pid) === i) {
        const parentRm = rmMap.get(pid) ?? null;
        const parentName = declarationNameFor(parentRm, "Sammensatt");
        const parentHasDeclName = typeof parentRm?.declaration_name === "string" && parentRm.declaration_name.trim() !== "";
        if (parentRm && !parentHasDeclName && !missingDeclMap.has(pid)) {
          missingDeclMap.set(pid, { raw_material_id: pid, name: parentRm.name ?? "Sammensatt", fallback_used: parentName });
        }
        const kids = (parentToChildren.get(pid) ?? []).slice().sort((x, y) => y.effective_grams - x.effective_grams);
        for (const k of kids) renderedKeys.add(k.key);
        ingredientParts.push(`${parentName} (${kids.map((k) => renderItem(k, false)).join(", ")})`);
        wrapped = true;
      } else if (wrapParents.has(pid)) {
        continue;
      }
    }
    if (!wrapped) {
      renderedKeys.add(a.key);
      ingredientParts.push(renderItem(a, true));
    }
  }
  const ingredientHtml = ingredientParts.join(", ");

  const allergenSet = new Set<string>();
  const mayContainSet = new Set<string>();
  for (const a of sortedAgg) {
    for (const al of a.allergens) allergenSet.add(al);
    for (const al of a.may_allergens) if (!allergenSet.has(al)) mayContainSet.add(al);
  }
  const containsList = [...allergenSet].map((a) => ALLERGEN_LABEL[a] ?? a).sort();
  const mayContainList = [...mayContainSet].map((a) => ALLERGEN_LABEL[a] ?? a).sort();

  // Næring — totalsummer (ikke delt på vekt ennå)
  const nutritionTotals: Record<string, number> = {};
  let coveredGrams = 0;
  for (const a of sortedAgg) {
    const n = a.raw_material_id ? nutritionByRm.get(a.raw_material_id) : null;
    if (!n) continue;
    coveredGrams += a.effective_grams;
    for (const f of NUT_FIELDS) {
      const v = Number(n[f]);
      if (Number.isFinite(v)) nutritionTotals[f] = (nutritionTotals[f] ?? 0) + (v * a.effective_grams) / 100;
    }
  }

  // Brødskala'n
  let totalFlour = 0, coarseWeighted = 0, ryeFlour = 0;
  const contributors: Array<{ name: string; grams: number; classification: string; weighted: number }> = [];
  const unclassified: string[] = [];
  for (const a of sortedAgg) {
    const c = a.grain_classification;
    const g = a.effective_grams;
    if (c === "sifted_flour" || c === "other_flour") {
      totalFlour += g;
      contributors.push({ name: a.name, grams: g, classification: c, weighted: 0 });
      if (a.cereal_type === "rug") ryeFlour += g;
    } else if (c === "whole_grain_flour" || c === "whole_grains" || c === "gluten_free_grain") {
      totalFlour += g; coarseWeighted += g;
      contributors.push({ name: a.name, grams: g, classification: c, weighted: g });
      if (a.cereal_type === "rug") ryeFlour += g;
    } else if (c === "wheat_bran" || c === "rye_bran" || c === "oat_bran") {
      const w = g * BRAN_FACTOR[c];
      coarseWeighted += w;
      contributors.push({ name: a.name, grams: g, classification: c, weighted: w });
      if (a.cereal_type === "rug" || c === "rye_bran") ryeFlour += g;
    } else if (c === "not_grain") {
      // hopp over
    } else if (g > 5 && !a.custom_text) {
      unclassified.push(a.name);
    }
  }
  const grainPct = totalFlour > 0 ? Math.round((coarseWeighted / totalFlour) * 1000) / 10 : null;

  return {
    sortedAgg,
    totalInputGrams,
    ingredientHtml,
    containsList,
    mayContainList,
    nutritionTotals,
    coveredGrams,
    breadscale: {
      total_flour_grams: totalFlour,
      coarse_grams_weighted: coarseWeighted,
      grain_pct: grainPct,
      grain_category: grainPct != null ? breadscaleCategory(grainPct) : null,
      contributors,
      unclassified,
    },
    rye_flour_grams: ryeFlour,
    composite_unreviewed,
    composite_text_only,
    missing_declaration_names: [...missingDeclMap.values()],
    rmMap,
    nutritionByRm,
  };
}
