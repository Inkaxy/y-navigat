// Beregner deklarasjon, næring, tørrstoff, grovhet (Brødskala'n) og Nøkkelhull for EN OPPSKRIFT.
// Deler kjernelogikk med compute-product-declaration via _shared/declaration-core.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  computeDeclarationCore,
  declarationGate,
  resolveFinalWeight,
  NUT_FIELDS,
  dryMatterGrams as dryMatterOfEntries,
  wholeGrainDryGrams,
  wholeGrainPctOfDry as wholeGrainPct,
  type TopLine,
} from "../_shared/declaration-core.ts";
import { expandRecipeLines, sumLineGrams } from "../_shared/recipe-lines.ts";
import { storeNutrient } from "../_shared/nutritionFormat.ts";
import { syncAutoProductsForRecipe } from "../_shared/effective-declaration.ts";
import { buildInputsHash, type HashMaterialFact } from "../_shared/recipe-label-hash.ts";
import { authorizeCron } from "../_shared/cron-auth.ts";
import { isGlutenFreeFromCodes, wholeGrainLimitFor } from "./keyhole.ts";

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
  // Gruppe 9 «Knekkebrød og annet flatbrød» har egne grenser.
  "9": {
    label: "Gruppe 9 — knekkebrød",
    criteria: [
      { key: "whole_grain_pct_of_dry", name: "Fullkorn av tørrstoff", op: "min" as const, limit: 50, unit: "%" },
      { key: "fiber_g", name: "Kostfiber", op: "min" as const, limit: 6, unit: "g/100 g" },
      { key: "fat_g", name: "Fett", op: "max" as const, limit: 7, unit: "g/100 g" },
      { key: "sugars_g", name: "Sukkerarter", op: "max" as const, limit: 5, unit: "g/100 g" },
      { key: "salt_g", name: "Salt", op: "max" as const, limit: 1.3, unit: "g/100 g" }, // Kilde: Veileder til nøkkelhullforskriften (mars 2021), kap. 4.5.3.4, gruppe 9
    ],
  },
};

/** Nøkkelhullet vurderes bare for brød, rundstykker og knekkebrød. */
function keyholeGroupForRecipe(category: string | null, name: string | null): "8a" | "9" | null {
  const hay = `${category ?? ""} ${name ?? ""}`.toLowerCase();
  if (/knekkebr|flatbr/.test(hay)) return "9";
  if (/br(ø|o)d|rundstykk|bagett|loff|ciabatta|focaccia|horn|bolle?br/.test(hay)) return "8a";
  return null;
}

/** Minste datadekning (andel av innveid vekt med næringsdata) for å konkludere om Nøkkelhullet. */
const KEYHOLE_MIN_COVERAGE_PCT = 90;

const NUTRIENT_KEYS = new Set(["fiber_g", "fat_g", "sugars_g", "salt_g"]);

function nb(n: number, decimals = 1): string {
  return Number(n).toFixed(decimals).replace(".", ",");
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
    const service = createClient(supabaseUrl, serviceKey);

    // Cron sender {recipe_id, source:'cron'} og kan mangle/ha tom Authorization —
    // den skal godkjennes på X-Cron-Secret FØR bearer-kravet under vurderes.
    const cronAuth = await authorizeCron(req, service);
    const isService = cronAuth === "service" || token === serviceKey;
    if (cronAuth === null && !isService) {
      if (!token) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userRes } = await userClient.auth.getUser();
      if (!userRes?.user) return json({ error: "Unauthorized" }, 401);
      const { data: access } = await userClient.from("recipes").select("id").eq("id", recipeId).maybeSingle();
      if (!access) return json({ error: "Forbidden" }, 403);
    }

    const { data: recipe } = await service
      .from("recipes")
      .select("id, name, category, yield_grams, yield_loss_pct, finished_weight_grams, yield_quantity, yield_unit")
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

    const warnings: string[] = [...expandWarnings];

    // 2) Vekter — ferdigvekt løses FØR beregningen, så QUID og vannregelen
    //    kan regnes mot ferdig produkt og ikke mot innveid deig.
    const inputGramsEstimate = sumLineGrams(topLines.filter((t) => t.include));
    const resolved = resolveFinalWeight(recipe, inputGramsEstimate);
    const finalWeight = resolved.grams || 1;
    if (resolved.source) warnings.push(resolved.source);
    else warnings.push("Ferdigvekt mangler — beregnet fra innveid vekt minus stektap");

    const yieldLossPct = Number(recipe.yield_loss_pct) || 0;
    const hasFinishedWeight = recipe.finished_weight_grams != null && Number(recipe.finished_weight_grams) > 0;
    // Uten stektap blir næring per 100 g regnet på deigvekt — 11–18 % for lavt for brød.
    // Kravet gjelder bare for oppskrifter Nøkkelhullet i det hele tatt vurderer
    // (brød, rundstykker, knekkebrød) — andre oppskrifter kan ha 0 % stektap uten sperre.
    const isKeyholeCandidate = keyholeGroupForRecipe(recipe.category ?? null, recipe.name ?? null) !== null;
    const missingBakeLoss = isKeyholeCandidate && !hasFinishedWeight && finalWeight >= inputGramsEstimate - 0.5;
    if (missingBakeLoss) {
      warnings.push("0 % stektap er registrert — BKLF antar ca. 12 % for brød. Næring per 100 g blir for lav til den er satt.");
    }

    const core = await computeDeclarationCore(service, topLines, { finalWeightGrams: finalWeight });
    const totalInputGrams = core.totalInputGrams;

    // 3) Tørrstoff — etter Nøkkelhull-veilederen (ukjent vanninnhold ⇒ × 0,85).
    const missingWater: string[] = [];
    for (const a of core.sortedAgg) {
      if (a.water_content_source === "unknown" && a.effective_grams > 5) missingWater.push(a.name);
    }
    const dryMatterGrams = dryMatterOfEntries(core.sortedAgg);
    const dryMatterPct = Math.round((dryMatterGrams / finalWeight) * 1000) / 10;
    if (missingWater.length) {
      warnings.push(`Mangler vanninnhold (antatt 85 % tørrstoff etter veilederen): ${missingWater.join(", ")}`);
    }

    // 4) Grovhet — Brødskala'n. Kli teller uvektet i nevneren og vektet i telleren.
    const flourGrams = core.breadscale.total_flour_grams;
    // Nøkkelhullets fullkorn: hele korn + sammalt mel, UTEN kli og uten faktor.
    const wholeGrainGrams = core.breadscale.whole_grain_grams;
    const breadscalePctRaw = core.breadscale.breadscale_pct;
    const grainScorePct = core.breadscale.grain_pct;
    const grainCategory = core.breadscale.grain_category;
    // Nøkkelhullets fullkornandel regnes av TØRRSTOFF: hver fullkornlinje med sin
    // egen tørrstoffandel (faktisk vanninnhold når kjent, ellers × 0,85) — ikke råvekt.
    const wholeGrainDry = wholeGrainDryGrams(core.sortedAgg);
    const wholeGrainPctOfDry = wholeGrainPct(wholeGrainDry, dryMatterGrams);
    if (core.breadscale.unclassified.length) {
      warnings.push(`Brødskala: ${core.breadscale.unclassified.length} ingrediens(er) er ikke klassifisert — grovheten kan være feil`);
    }
    const grainTextLines = core.breadscale.free_text_grain_lines;
    if (grainTextLines.length) {
      warnings.push(
        `Brødskala: ${grainTextLines.length} fritekstlinje(r) med korn er ikke koblet til råvare (${grainTextLines.map((l) => l.name).join(", ")}) — merket kan ikke settes`,
      );
    }

    // 5) Rugandel
    const ryeSharePct = flourGrams > 0 ? Math.round((core.rye_flour_grams / flourGrams) * 1000) / 10 : null;

    // 6) Næring pr 100 g — MOT FERDIGVEKT (vann fordamper under steking).
    //    Lagres URUNDET (3 desimaler); avrunding skjer bare ved visning.
    const per100: Record<string, number | null> = {};
    for (const f of NUT_FIELDS) {
      const t = core.nutritionTotals[f];
      per100[f] = t != null ? storeNutrient((t / finalWeight) * 100) : null;
    }
    // Fiber vises ikke når ikke alle bidragsytere har fiberverdi.
    if (!core.fiber_complete) per100.fiber_g = null;

    // 7) Datadekning målt i VEKT — ÉN kilde: kjernen regner teller og nevner
    // med samme (post-vannregel) sum, se declaration-core.ts.
    const coveragePct = core.coverage_pct;
    const missingNutrition = core.missing_nutrition.map((m) => ({
      raw_material_id: m.raw_material_id,
      name: m.name,
      grams: m.grams,
      pct_of_dough: m.pct_of_weight,
      critical: m.critical,
    }));
    if (coveragePct < 90) warnings.push(`Kun ${nb(coveragePct)} % av deigvekten har næringsdata`);
    const gate = declarationGate(core, coveragePct);
    if (missingBakeLoss) {
      gate.reasons.push("0 % stektap – sett stektap eller ferdigvekt");
      gate.blocked = true;
    }
    for (const r of gate.reasons) if (!warnings.includes(r)) warnings.push(r);

    // 8) Nøkkelhullet
    const measured: Record<string, number | null> = {
      whole_grain_pct_of_dry: wholeGrainPctOfDry,
      rye_share_of_grain_pct: ryeSharePct,
      fiber_g: per100.fiber_g,
      fat_g: per100.fat_g,
      sugars_g: per100.sugars_g,
      salt_g: per100.salt_g,
    };

    // Glutenfritt avgjøres av allergenKODENE, ikke av de norske etikettene.
    const isGlutenFree = isGlutenFreeFromCodes(core.containsCodes);

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

    // Gruppevalg, kriterier og status ligger i keyhole.ts (ren, testet funksjon).
    const keyholeEval = evaluateKeyhole(
      {
        containsCodes: core.containsCodes,
        whole_grain_pct_of_dry: wholeGrainPctOfDry,
        rye_share_of_grain_pct: ryeSharePct,
        free_text_grain_lines: grainTextLines,
        missing_bake_loss: missingBakeLoss,
      },
      { category: recipe.category ?? null, name: recipe.name ?? null },
      {
        fiber_g: per100.fiber_g,
        fat_g: per100.fat_g,
        sugars_g: per100.sugars_g,
        salt_g: per100.salt_g,
      },
      coveragePct,
    );

    const best = keyholeEval.best;
    const bestAdvice = (best?.criteria ?? [])
      .filter((c) => c.met === false)
      .map((c) => adviceFor({ key: c.key, name: c.name, op: c.op, limit: c.limit, unit: c.unit }, c.value as number));

    const keyhole = {
      group: best?.group ?? null,
      group_label: best?.group_label ?? "Ikke vurdert",
      group_choice_reason: keyholeEval.groupChoiceReason,
      status: keyholeEval.status,
      qualifies: keyholeEval.status === "oppfylt",
      status_reason: keyholeEval.statusReason,
      min_coverage_pct: KEYHOLE_MIN_COVERAGE_PCT,
      coverage_by_weight_pct: coveragePct,
      criteria: best?.criteria ?? [],
      advice: keyholeEval.status === "ukjent" ? [] : bestAdvice,
      evaluated_groups: keyholeEval.evaluations.map((e) => ({ group: e.group, all_met: e.allMet, any_unknown: e.anyUnknown })),
    };


    const missing_data = {
      nutrition: missingNutrition,
      water_content: missingWater,
      unclassified_grain_names: core.breadscale.unclassified,
      free_text_grain_lines: grainTextLines,
      composite_unreviewed: core.composite_unreviewed,
      composite_text_only: core.composite_text_only,
      composite_percent_residual: core.composite_percent_residual,
      declaration_names: core.missing_declaration_names,
      lines_without_raw_material: core.sortedAgg.filter((a) => !a.raw_material_id).length,
      lines_without_nutrition_over_pct: core.lines_without_nutrition_over_pct,
      critical_missing_nutrition: core.critical_missing_nutrition,
      allergens_unreviewed: core.missing_allergens,
      unit_problems: core.unit_problems,
      free_text_lines: core.free_text_lines,
      fiber_complete: core.fiber_complete,
      missing_bake_loss: missingBakeLoss,
      blocked: gate.blocked,
      block_reasons: gate.reasons,
    };

    if (core.missing_declaration_names.length) {
      warnings.push(
        `${core.missing_declaration_names.length} råvare(r) mangler deklarasjonsnavn — innkjøpsnavnet brukes midlertidig: ${core.missing_declaration_names.map((m) => m.name).join(", ")}`,
      );
    }

    const allergens = { contains: core.containsList, may_contain: core.mayContainList };

    // --- inputs_hash: fanger linjer, yield-felt og fakta om hver råvare ---
    // Feiler dette oppslaget av en eller annen grunn, lagres beregningen likevel —
    // is_stale-triggeren nullstiller uansett feltet ved neste reelle endring.
    let inputsHash: string | null = null;
    try {
      const { data: rawLines } = await service
        .from("recipe_lines")
        .select(
          "raw_material_id, sub_product_id, ingredient_name, quantity, waste_percent, include_in_declaration, custom_declaration_text",
        )
        .eq("recipe_id", recipeId);

      const rmIds = [...core.rmMap.keys()];
      const { data: allergenRows } = rmIds.length
        ? await service
          .from("raw_material_allergens")
          .select("raw_material_id, allergen")
          .in("raw_material_id", rmIds)
        : { data: [] as { raw_material_id: string; allergen: string }[] };
      const allergensByRm = new Map<string, string[]>();
      for (const a of allergenRows ?? []) {
        const arr = allergensByRm.get(a.raw_material_id) ?? [];
        arr.push(a.allergen);
        allergensByRm.set(a.raw_material_id, arr);
      }

      const materials: HashMaterialFact[] = rmIds.map((id) => {
        const rm = core.rmMap.get(id) ?? {};
        const nutrition = core.nutritionByRm.get(id) ?? null;
        return {
          raw_material_id: id,
          declaration_name: rm.declaration_name ?? null,
          water_content_pct: rm.water_content_pct ?? null,
          grain_classification: rm.grain_classification ?? null,
          cereal_type: rm.cereal_type ?? null,
          unit_weight_grams: rm.unit_weight_grams ?? null,
          allergens: allergensByRm.get(id) ?? [],
          nutrition_updated_at: nutrition?.updated_at ?? null,
        };
      });

      inputsHash = await buildInputsHash(
        (rawLines ?? []).map((l) => ({
          raw_material_id: l.raw_material_id ?? null,
          sub_product_id: l.sub_product_id ?? null,
          ingredient_name: l.ingredient_name ?? null,
          grams: l.quantity ?? null,
          waste_percent: l.waste_percent ?? null,
          include_in_declaration: l.include_in_declaration !== false,
          custom_declaration_text: l.custom_declaration_text ?? null,
        })),
        {
          yield_grams: recipe.yield_grams ?? null,
          yield_loss_pct: recipe.yield_loss_pct ?? null,
          finished_weight_grams: recipe.finished_weight_grams ?? null,
          yield_quantity: recipe.yield_quantity ?? null,
          yield_unit: recipe.yield_unit ?? null,
        },
        materials,
      );
    } catch (e) {
      console.error("compute-recipe-label inputs_hash", e);
    }

    // Kli i Brødskala'ns bidragsytere — brukes til bran_grams uavhengig av vekting.
    const branGrams = core.breadscale.contributors
      .filter((c) => c.classification.endsWith("_bran"))
      .reduce((sum, c) => sum + c.grams, 0);

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
      nutrition_per_100g_raw: per100,
      coverage_by_nutrient: core.coverage_by_nutrient,
      ingredient_declaration: core.ingredientHtml,
      // Ren tekst med *stjernemarkering* — brukes av etikett-PDF og nettbutikk.
      lines: {
        ingredient_declaration_text: core.ingredientText,
        // BKLF-prosenten kan overstige 100. Kolonnen har CHECK ≤ 100, så det
        // urundede tallet lagres her og brukes til teksten under merket.
        breadscale_pct: breadscalePctRaw,
        breadscale_pct_display: core.breadscale.breadscale_pct_display,
        breadscale_contributors: core.breadscale.contributors,
        whole_grain_grams_no_bran: Math.round(wholeGrainGrams * 100) / 100,
        // Brødskala'ns TELLER: grovt korn med kli vektet. `whole_grain_grams`
        // er Nøkkelhullets fullkorn (uten kli, uvektet) og er noe annet.
        coarse_weighted_grams: Math.round(core.breadscale.coarse_grams_weighted * 100) / 100,
      },
      allergens,
      keyhole,
      coverage_by_weight_pct: coveragePct,
      missing_data,
      warnings,
      inputs_hash: inputsHash,
      breadscale_denominator_grams: Math.round(flourGrams * 100) / 100,
      bran_grams: Math.round(branGrams * 100) / 100,
      whole_grain_grams_keyhole: Math.round(wholeGrainGrams * 100) / 100,
      keyhole_group: keyhole.group,
      // is_stale settes IKKE her — DB-triggeren nullstiller den ved reelle endringer.
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
        blocked: gate.blocked,
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
