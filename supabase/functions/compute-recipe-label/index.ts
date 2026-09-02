// Beregner deklarasjon, næring, tørrstoff, grovhet (Brødskala'n) og Nøkkelhull for EN OPPSKRIFT.
// Deler kjernelogikk med compute-product-declaration via _shared/declaration-core.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  computeDeclarationCore,
  toGrams,
  NUT_FIELDS,
  type TopLine,
} from "../_shared/declaration-core.ts";
import { syncAutoProductsForRecipe } from "../_shared/effective-declaration.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * NØKKELHULLKRITERIER
 * Kilde: Mattilsynets veileder til forskrift om frivillig merking av næringsmidler
 * med Nøkkelhullet (nøkkelhullforskriften), produktgruppe 8 «Brød».
 * Oppdater tallene her hvis forskriften endres.
 */
const KEYHOLE_GROUPS = {
  "8a": {
    label: "Gruppe 8a — brød",
    criteria: [
      { key: "whole_grain_pct_of_dry", name: "Fullkorn av tørrstoff", op: "min" as const, limit: 30, unit: "%" },
      { key: "fiber_g", name: "Kostfiber", op: "min" as const, limit: 5, unit: "g/100 g" },
      { key: "fat_g", name: "Fett", op: "max" as const, limit: 7, unit: "g/100 g" },
      { key: "sugars_g", name: "Sukkerarter", op: "max" as const, limit: 5, unit: "g/100 g" },
      { key: "salt_g", name: "Salt", op: "max" as const, limit: 1.0, unit: "g/100 g" },
    ],
  },
  "8b": {
    label: "Gruppe 8b — rugbrød",
    criteria: [
      { key: "whole_grain_pct_of_dry", name: "Fullkorn av tørrstoff", op: "min" as const, limit: 35, unit: "%" },
      { key: "fiber_g", name: "Kostfiber", op: "min" as const, limit: 6, unit: "g/100 g" },
      { key: "fat_g", name: "Fett", op: "max" as const, limit: 7, unit: "g/100 g" },
      { key: "sugars_g", name: "Sukkerarter", op: "max" as const, limit: 5, unit: "g/100 g" },
      { key: "salt_g", name: "Salt", op: "max" as const, limit: 1.2, unit: "g/100 g" },
      { key: "rye_share_of_grain_pct", name: "Rugandel av kornet", op: "min" as const, limit: 30, unit: "%" },
    ],
  },
};

/** Minste datadekning (andel av innveid vekt med næringsdata) for å konkludere om Nøkkelhullet. */
const KEYHOLE_MIN_COVERAGE_PCT = 90;

const NUTRIENT_KEYS = new Set(["fiber_g", "fat_g", "sugars_g", "salt_g"]);

function nb(n: number, decimals = 1): string {
  return Number(n).toFixed(decimals).replace(".", ",");
}


/** Maks nivåer halvfabrikat-i-halvfabrikat som følges. Beskytter mot sykluser. */
const MAX_SUB_DEPTH = 4;

const LINE_SELECT =
  "id, raw_material_id, sub_product_id, ingredient_name, quantity, unit, waste_percent, include_in_declaration, is_quid_relevant, custom_declaration_text, water_content_pct_override, sort_order, raw_materials(id, name, unit_weight_grams, is_composite, grain_classification, cereal_type, water_content_pct, components_reviewed_at)";

/**
 * Ferdigvekt for en oppskrift, i prioritert rekkefølge:
 * 1) `yield_grams` (total ferdigvekt), 2) `finished_weight_grams` × `yield_quantity`
 * når utbyttet er i stk, 3) innveid vekt minus stektap.
 * Returnerer også hvilken kilde som ble brukt, til warnings.
 */
function resolveFinalWeight(
  recipe: any,
  inputGrams: number,
): { grams: number; source: string | null } {
  const y = recipe?.yield_grams != null ? Number(recipe.yield_grams) : null;
  if (y != null && y > 0) return { grams: y, source: `Ferdigvekt: ${y} g fra feltet «Utbytte (g)»` };

  const per = recipe?.finished_weight_grams != null ? Number(recipe.finished_weight_grams) : null;
  const qty = recipe?.yield_quantity != null ? Number(recipe.yield_quantity) : null;
  const unit = String(recipe?.yield_unit ?? "").toLowerCase();
  if (per != null && per > 0 && qty != null && qty > 0 && (unit === "stk" || unit === "")) {
    return {
      grams: per * qty,
      source: `Ferdigvekt: ${qty} stk × ${per} g fra Oppskrift-fanen`,
    };
  }

  const loss = Number(recipe?.yield_loss_pct) || 0;
  return {
    grams: inputGrams * (1 - loss / 100) || 0,
    source: null,
  };
}

/** Ferdigvekt for en oppskrift (kun tallet) — brukes for halvfabrikater. */
function finalWeightOf(recipe: any, inputGrams: number): number {
  return resolveFinalWeight(recipe, inputGrams).grams;
}


/**
 * Leser oppskriftslinjer og erstatter halvfabrikat-linjer (`sub_product_id`)
 * med halvfabrikatets egne ingredienser, skalert etter hvor mange gram av
 * halvfabrikatet som inngår. Slik forplanter allergener og ingredienser seg
 * oppover i stedet for å forsvinne.
 */
async function expandRecipeLines(
  service: any,
  recipeId: string,
  depth: number,
  seen: Set<string>,
  warnings: string[],
): Promise<TopLine[]> {
  const { data: lines } = await service
    .from("recipe_lines")
    .select(LINE_SELECT)
    .eq("recipe_id", recipeId)
    .order("sort_order");

  const out: TopLine[] = [];
  for (const l of (lines ?? []) as any[]) {
    const rm = l.raw_materials;
    const base: TopLine = {
      source: "master",
      raw_material: rm ?? null,
      raw_material_id: l.raw_material_id ?? null,
      name: rm?.name ?? l.ingredient_name ?? "(ukjent)",
      quantity: Number(l.quantity) || 0,
      unit: l.unit ?? "g",
      waste_percent: Number(l.waste_percent) || 0,
      include: l.include_in_declaration !== false,
      is_quid: !!l.is_quid_relevant,
      custom_text: l.custom_declaration_text || null,
      unit_weight_grams: rm?.unit_weight_grams ?? null,
      water_content_pct_override: l.water_content_pct_override ?? null,
    };

    if (!l.sub_product_id) {
      out.push(base);
      continue;
    }

    const neededGrams = toGrams(base.quantity, base.unit, base.unit_weight_grams);
    if (neededGrams <= 0) {
      out.push(base);
      continue;
    }

    if (depth >= MAX_SUB_DEPTH) {
      warnings.push(`Halvfabrikat «${base.name}» går dypere enn ${MAX_SUB_DEPTH} nivåer — ingrediensene er ikke regnet med`);
      out.push(base);
      continue;
    }

    const { data: link } = await service
      .from("product_recipe_links")
      .select("recipe_id, is_primary")
      .eq("product_id", l.sub_product_id)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    const subRecipeId: string | null = link?.recipe_id ?? null;

    if (!subRecipeId || seen.has(subRecipeId)) {
      if (subRecipeId) warnings.push(`Halvfabrikat «${base.name}» peker i ring — hoppet over`);
      else warnings.push(`Halvfabrikat «${base.name}» mangler oppskrift — ingrediensene er ikke regnet med`);
      out.push(base);
      continue;
    }

    const { data: subRecipe } = await service
      .from("recipes")
      .select("id, name, yield_grams, yield_loss_pct")
      .eq("id", subRecipeId)
      .maybeSingle();

    const subLines = await expandRecipeLines(
      service,
      subRecipeId,
      depth + 1,
      new Set([...seen, subRecipeId]),
      warnings,
    );
    const subInput = subLines.reduce(
      (sum, sl) => sum + toGrams(sl.quantity, sl.unit, sl.unit_weight_grams) * (1 + sl.waste_percent / 100),
      0,
    );
    const subFinal = finalWeightOf(subRecipe, subInput);
    if (subFinal <= 0 || subInput <= 0) {
      warnings.push(`Halvfabrikat «${base.name}» mangler vekt — ingrediensene er ikke regnet med`);
      out.push(base);
      continue;
    }

    // Skaler halvfabrikatets innveide gram til andelen som faktisk brukes her.
    const factor = (neededGrams / subFinal) * (1 + base.waste_percent / 100);
    for (const sl of subLines) {
      out.push({
        ...sl,
        quantity: toGrams(sl.quantity, sl.unit, sl.unit_weight_grams) * (1 + sl.waste_percent / 100) * factor,
        unit: "g",
        waste_percent: 0,
        include: base.include && sl.include,
      });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const recipeId: string | null = body.recipe_id ?? null;
    if (!recipeId) return json({ error: "recipe_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!token) return json({ error: "Unauthorized" }, 401);

    const isService = token === serviceKey;
    if (!isService) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) return json({ error: "Unauthorized" }, 401);
      const { data: access } = await userClient.from("recipes").select("id").eq("id", recipeId).maybeSingle();
      if (!access) return json({ error: "Forbidden" }, 403);
    }

    const service = createClient(supabaseUrl, serviceKey);

    const { data: recipe } = await service
      .from("recipes")
      .select("id, name, yield_grams, yield_loss_pct")
      .eq("id", recipeId)
      .maybeSingle();
    if (!recipe) return json({ error: "Recipe not found" }, 404);

    // 1) Topplinjer (alle deler, inkl. fordeiger) — halvfabrikater brettes ut rekursivt
    const expandWarnings: string[] = [];
    const topLines: TopLine[] = await expandRecipeLines(
      service,
      recipeId,
      0,
      new Set([recipeId]),
      expandWarnings,
    );

    const core = await computeDeclarationCore(service, topLines);
    const warnings: string[] = [...expandWarnings];

    // 2) Vekter — ferdigvekt fra yield_grams, ellers innveid minus stektap
    const totalInputGrams = core.totalInputGrams;
    const yieldGrams = recipe.yield_grams != null ? Number(recipe.yield_grams) : null;
    const yieldLoss = Number(recipe.yield_loss_pct) || 0;
    const finalWeight = (yieldGrams ?? totalInputGrams * (1 - yieldLoss / 100)) || 1;
    if (yieldGrams == null) warnings.push("Ferdigvekt mangler — beregnet fra innveid vekt minus stektap");

    // 3) Tørrstoff
    let dryMatterGrams = 0;
    const missingWater: string[] = [];
    for (const a of core.sortedAgg) {
      const pct = a.water_content_pct ?? 0;
      if (a.water_content_source === "unknown" && a.effective_grams > 5) missingWater.push(a.name);
      dryMatterGrams += a.effective_grams * (1 - pct / 100);
    }
    const dryMatterPct = Math.round((dryMatterGrams / finalWeight) * 1000) / 10;
    if (missingWater.length) {
      warnings.push(`Mangler vanninnhold (antatt 0 %): ${missingWater.join(", ")}`);
    }

    // 4) Grovhet — Brødskala'n
    const flourGrams = core.breadscale.total_flour_grams;
    const wholeGrainGrams = core.breadscale.coarse_grams_weighted;
    const grainScorePct = core.breadscale.grain_pct;
    const grainCategory = core.breadscale.grain_category;
    const wholeGrainPctOfDry = dryMatterGrams > 0
      ? Math.round((wholeGrainGrams / dryMatterGrams) * 1000) / 10
      : null;
    if (core.breadscale.unclassified.length) {
      warnings.push(`Brødskala: ${core.breadscale.unclassified.length} ingrediens(er) er ikke klassifisert — grovheten kan være feil`);
    }

    // 5) Rugandel
    const ryeSharePct = flourGrams > 0 ? Math.round((core.rye_flour_grams / flourGrams) * 1000) / 10 : null;

    // 6) Næring pr 100 g — MOT FERDIGVEKT (vann fordamper under steking)
    const per100: Record<string, number | null> = {};
    for (const f of NUT_FIELDS) {
      const t = core.nutritionTotals[f];
      per100[f] = t != null ? Math.round((t / finalWeight) * 1000) / 10 : null;
    }

    // 7) Datadekning målt i VEKT
    const coveragePct = Math.round((core.coveredGrams / totalInputGrams) * 1000) / 10;
    const missingNutrition = core.sortedAgg
      .filter((a) => !a.has_nutrition)
      .map((a) => ({
        raw_material_id: a.raw_material_id,
        name: a.name,
        grams: Math.round(a.effective_grams * 10) / 10,
        pct_of_dough: Math.round((a.effective_grams / totalInputGrams) * 1000) / 10,
      }))
      .sort((x, y) => y.grams - x.grams);
    if (coveragePct < 90) warnings.push(`Kun ${nb(coveragePct)} % av deigvekten har næringsdata`);

    // 8) Nøkkelhullet
    const measured: Record<string, number | null> = {
      whole_grain_pct_of_dry: wholeGrainPctOfDry,
      rye_share_of_grain_pct: ryeSharePct,
      fiber_g: per100.fiber_g,
      fat_g: per100.fat_g,
      sugars_g: per100.sugars_g,
      salt_g: per100.salt_g,
    };

    // Gramendring for et næringskriterium: hvor mye må ingrediensen ned/opp i deigen?
    function adviceFor(c: { key: string; name: string; op: "min" | "max"; limit: number; unit: string }, value: number): string {
      const diff = c.op === "max" ? value - c.limit : c.limit - value;
      if (c.key === "salt_g") {
        // Salt kommer nesten utelukkende fra salt-råvaren: regn faktisk gramendring.
        const saltLine = core.sortedAgg.find((a) => /\bsalt\b/i.test(a.name));
        const gramsNow = saltLine ? saltLine.effective_grams : null;
        const targetGrams = gramsNow != null && value > 0 ? gramsNow * (c.limit / value) : null;
        if (gramsNow != null && targetGrams != null) {
          return `Saltet er ${nb(value)} g/100 g. Grensen er ${nb(c.limit)}. Reduser saltet fra ${nb(gramsNow, 0)} g til ${nb(targetGrams, 0)} g i deigen.`;
        }
        return `Saltet er ${nb(value)} g/100 g. Grensen er ${nb(c.limit)}. Reduser saltet med ${nb(diff)} g/100 g.`;
      }
      if (c.key === "sugars_g" || c.key === "fat_g") {
        const gramsPerBatchOver = (diff / 100) * finalWeight;
        return `${c.name} er ${nb(value)} ${c.unit}. Grensen er ${nb(c.limit)}. Reduser med omtrent ${nb(gramsPerBatchOver, 0)} g i deigen.`;
      }
      if (c.key === "fiber_g") {
        const gramsNeeded = (diff / 100) * finalWeight;
        return `Kostfiber er ${nb(value)} ${c.unit}. Kravet er minst ${nb(c.limit)}. Deigen trenger omtrent ${nb(gramsNeeded, 0)} g mer fiber — bytt siktet mel mot fullkorn eller tilsett kli.`;
      }
      if (c.key === "whole_grain_pct_of_dry") {
        const neededWholeGrain = (c.limit / 100) * dryMatterGrams - wholeGrainGrams;
        return `Fullkornandelen er ${nb(value)} % av tørrstoffet. Kravet er minst ${nb(c.limit)} %. Bytt omtrent ${nb(Math.max(0, neededWholeGrain), 0)} g siktet mel til fullkornsmel.`;
      }
      if (c.key === "rye_share_of_grain_pct") {
        const neededRye = (c.limit / 100) * flourGrams - core.rye_flour_grams;
        return `Rugandelen er ${nb(value)} % av kornet. Kravet er minst ${nb(c.limit)} %. Bytt omtrent ${nb(Math.max(0, neededRye), 0)} g av melet til rugmel.`;
      }
      return `${c.name} er ${nb(value)} ${c.unit}. Kravet er ${c.op === "max" ? "høyst" : "minst"} ${nb(c.limit)}.`;
    }

    function evaluateGroup(groupKey: "8a" | "8b") {
      const g = KEYHOLE_GROUPS[groupKey];
      const criteria = g.criteria.map((c) => {
        const value = measured[c.key];
        const needsNutrition = NUTRIENT_KEYS.has(c.key);
        const unknown = value == null || (needsNutrition && coveragePct < KEYHOLE_MIN_COVERAGE_PCT);
        const met = unknown ? null : (c.op === "max" ? value! <= c.limit : value! >= c.limit);
        return {
          key: c.key,
          name: c.name,
          requirement: `${c.op === "max" ? "høyst" : "minst"} ${nb(c.limit)} ${c.unit}`,
          limit: c.limit,
          op: c.op,
          unit: c.unit,
          value: value ?? null,
          met,
          difference: value == null ? null : Math.round((c.op === "max" ? value - c.limit : value - c.limit) * 100) / 100,
        };
      });
      const anyUnknown = criteria.some((c) => c.met === null);
      const allMet = criteria.every((c) => c.met === true);
      const advice = criteria
        .filter((c) => c.met === false)
        .map((c) => adviceFor(g.criteria.find((x) => x.key === c.key)!, c.value as number));
      return { group: groupKey, group_label: g.label, criteria, allMet, anyUnknown, advice };
    }

    // Gruppevalg: rugandel ≥ 30 % ⇒ vurder 8b, ellers 8a. Vurder begge og velg beste resultat.
    const candidates: ("8a" | "8b")[] = (ryeSharePct ?? 0) >= 30 ? ["8b", "8a"] : ["8a"];
    const evaluations = candidates.map(evaluateGroup);
    const best = evaluations.find((e) => e.allMet && !e.anyUnknown) ?? evaluations[0];

    let keyholeStatus: "oppfylt" | "ikke_oppfylt" | "ukjent";
    let statusReason: string | null = null;
    if (coveragePct < KEYHOLE_MIN_COVERAGE_PCT) {
      keyholeStatus = "ukjent";
      statusReason = `Datadekningen er ${nb(coveragePct)} % av deigvekten. Det kreves minst ${KEYHOLE_MIN_COVERAGE_PCT} % næringsdekning for å konkludere.`;
    } else if (best.anyUnknown) {
      keyholeStatus = "ukjent";
      statusReason = "Ett eller flere kriterier mangler data.";
    } else {
      keyholeStatus = best.allMet ? "oppfylt" : "ikke_oppfylt";
    }

    const keyhole = {
      group: best.group,
      group_label: best.group_label,
      group_choice_reason: (ryeSharePct ?? 0) >= 30
        ? `Rugandelen er ${nb(ryeSharePct ?? 0)} % — vurdert mot rugbrødgruppen.`
        : `Rugandelen er ${ryeSharePct == null ? "ukjent" : nb(ryeSharePct) + " %"} — vurdert mot brødgruppen.`,
      status: keyholeStatus,
      qualifies: keyholeStatus === "oppfylt",
      status_reason: statusReason,
      min_coverage_pct: KEYHOLE_MIN_COVERAGE_PCT,
      coverage_by_weight_pct: coveragePct,
      criteria: best.criteria,
      advice: keyholeStatus === "ukjent" ? [] : best.advice,
      evaluated_groups: evaluations.map((e) => ({ group: e.group, all_met: e.allMet, any_unknown: e.anyUnknown })),
    };

    const missing_data = {
      nutrition: missingNutrition,
      water_content: missingWater,
      unclassified_grain_names: core.breadscale.unclassified,
      composite_unreviewed: core.composite_unreviewed,
      composite_text_only: core.composite_text_only,
      lines_without_raw_material: core.sortedAgg.filter((a) => !a.raw_material_id).length,
    };

    const allergens = { contains: core.containsList, may_contain: core.mayContainList };

    const row = {
      recipe_id: recipeId,
      computed_at: new Date().toISOString(),
      total_input_grams: Math.round(totalInputGrams * 100) / 100,
      final_weight_grams: Math.round(finalWeight * 100) / 100,
      dry_matter_grams: Math.round(dryMatterGrams * 100) / 100,
      dry_matter_pct: dryMatterPct,
      flour_grams: Math.round(flourGrams * 100) / 100,
      whole_grain_grams: Math.round(wholeGrainGrams * 100) / 100,
      whole_grain_pct_of_dry: wholeGrainPctOfDry,
      grain_score_pct: grainScorePct,
      grain_category: grainCategory,
      rye_share_of_grain_pct: ryeSharePct,
      nutrition_per_100g: per100,
      ingredient_declaration: core.ingredientHtml,
      allergens,
      keyhole,
      coverage_by_weight_pct: coveragePct,
      missing_data,
      warnings,
    };

    const { error: upsertErr } = await service
      .from("recipe_label_calculated")
      .upsert(row as never, { onConflict: "recipe_id" });
    if (upsertErr) {
      console.error("compute-recipe-label upsert", upsertErr);
      return json({ error: "save_failed", detail: upsertErr.message }, 500);
    }

    // Effektiv deklarasjon: produkter koblet til oppskriften der modus er «auto»
    // får snapshotet oppdatert med den ferske beregningen.
    let synced = 0;
    try {
      synced = await syncAutoProductsForRecipe(service, recipeId, {
        ingredient_declaration: row.ingredient_declaration,
        allergens: row.allergens,
        nutrition_per_100g: row.nutrition_per_100g,
        coverage_by_weight_pct: row.coverage_by_weight_pct,
      });
    } catch (e) {
      console.error("compute-recipe-label sync", e);
    }

    return json({ ...row, synced_products: synced });
  } catch (e) {
    console.error("compute-recipe-label", e);
    return json({ error: "internal_error" }, 500);
  }
});
