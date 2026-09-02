// Beregner deklarasjon, allergener og næring PR PRODUKT-KOBLING.
// - Master + extra-linjer slås sammen
// - Kjernelogikken (dekomponering, aggregering, QUID, allergener, næring, Brødskala'n)
//   ligger i _shared/declaration-core.ts og deles med compute-recipe-label.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeDeclarationCore, NUT_FIELDS, type TopLine } from "../_shared/declaration-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    let linkId: string | null = body.product_recipe_link_id ?? null;
    const productId: string | null = body.product_id ?? null;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (!linkId && productId) {
      const { data } = await service.from("product_recipe_links").select("id").eq("product_id", productId).order("is_primary", { ascending: false }).limit(1).maybeSingle();
      linkId = data?.id ?? null;
    }
    if (!linkId) return new Response(JSON.stringify({ error: "product_recipe_link_id or product_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: accessCheck } = await userClient.from("product_recipe_links").select("id").eq("id", linkId).maybeSingle();
    if (!accessCheck) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: link } = await service
      .from("product_recipe_links")
      .select(`
        id, product_id, recipe_id, extra_lines, yield_weight_g_override,
        declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary,
        products(id, display_name),
        recipes(id, declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary, yield_grams, yield_loss_pct)
      `)
      .eq("id", linkId)
      .maybeSingle();
    if (!link) return new Response(JSON.stringify({ error: "Link not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const recipe = (link as any).recipes;
    const product = (link as any).products;

    const { data: masterLines } = await service
      .from("recipe_lines")
      .select("id, raw_material_id, ingredient_name, quantity, unit, waste_percent, include_in_declaration, is_quid_relevant, custom_declaration_text, sort_order, raw_materials(id, name, unit_weight_grams, is_composite, grain_classification, components_reviewed_at)")
      .eq("recipe_id", link.recipe_id)
      .order("sort_order");

    const extraLinesArr = Array.isArray(link.extra_lines) ? link.extra_lines as any[] : [];
    const extraRmIds = extraLinesArr.map((e) => e.raw_material_id).filter(Boolean);
    const extraRmMap = new Map<string, any>();
    if (extraRmIds.length) {
      const { data: rms } = await service
        .from("raw_materials")
        .select("id, name, unit_weight_grams, is_composite, grain_classification, components_reviewed_at")
        .in("id", extraRmIds);
      for (const r of rms ?? []) extraRmMap.set(r.id, r);
    }

    const topLines: TopLine[] = [];
    for (const l of masterLines ?? []) {
      const rm = (l as any).raw_materials;
      topLines.push({
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
      });
    }
    for (const e of extraLinesArr) {
      const rm = e.raw_material_id ? extraRmMap.get(e.raw_material_id) : null;
      topLines.push({
        source: "extra",
        raw_material: rm ?? null,
        raw_material_id: e.raw_material_id ?? null,
        name: rm?.name ?? e.ingredient_name ?? e.name ?? "(ukjent tillegg)",
        quantity: Number(e.quantity ?? e.quantity_amount) || 0,
        unit: e.unit ?? e.quantity_unit ?? "g",
        waste_percent: Number(e.waste_percent) || 0,
        include: e.include_in_declaration !== false,
        is_quid: !!e.is_quid_relevant,
        custom_text: e.custom_declaration_text || null,
        unit_weight_grams: rm?.unit_weight_grams ?? null,
      });
    }

    const core = await computeDeclarationCore(service, topLines);
    const sortedAgg = core.sortedAgg;
    const totalInputGrams = core.totalInputGrams;

    const yieldGrams = link.yield_weight_g_override ?? recipe?.yield_grams ?? null;
    const yieldLoss = Number(recipe?.yield_loss_pct) || 0;
    const finalWeight = (yieldGrams ?? (totalInputGrams * (1 - yieldLoss / 100))) || 1;

    const per100: Record<string, number | null> = {};
    for (const f of NUT_FIELDS) {
      const t = core.nutritionTotals[f];
      per100[f] = t != null ? Math.round((t / finalWeight) * 1000) / 10 : null;
    }

    const grainPct = core.breadscale.grain_pct;
    const grainCategory = core.breadscale.grain_category;
    const totalFlour = core.breadscale.total_flour_grams;
    const coarseWeighted = core.breadscale.coarse_grams_weighted;
    const breadscaleUnclassified = core.breadscale.unclassified;
    const flourRatioOfTotal = totalInputGrams > 0 ? totalFlour / totalInputGrams : 0;

    if (grainPct != null) {
      await service.from("recipe_grain_score").upsert({
        product_recipe_link_id: linkId,
        total_flour_grams: totalFlour,
        coarse_grams_weighted: coarseWeighted,
        grain_score_pct: grainPct,
        category: grainCategory,
        classification_complete: breadscaleUnclassified.length === 0,
        unclassified_count: breadscaleUnclassified.length,
        unclassified_names: breadscaleUnclassified,
        computed_at: new Date().toISOString(),
      } as never, { onConflict: "product_recipe_link_id" });
    }

    // Datakvalitet
    const linesWithoutRm = sortedAgg.filter((a) => !a.raw_material_id).length;
    const linesWithoutNut = sortedAgg.filter((a) => a.raw_material_id && !a.has_nutrition).length;
    const nutritionCoveragePct = Math.round((core.coveredGrams / (totalInputGrams || 1)) * 100);

    const warnings: string[] = [];
    if (yieldGrams == null) warnings.push("Mangler ferdigvekt — næring pr 100 g antar input-vekt");
    if (linesWithoutRm) warnings.push(`${linesWithoutRm} aggregert(e) ingrediens(er) mangler råvare-kobling`);
    if (linesWithoutNut) warnings.push(`${linesWithoutNut} råvare(r) mangler næringsdata`);
    if (core.composite_unreviewed.length) warnings.push(`Sammensatt råvare uten review: ${core.composite_unreviewed.join(", ")}`);
    if (core.composite_text_only.length) warnings.push(`${core.composite_text_only.length} komponent(er) er fritekst (uten råvare-kobling)`);
    if (core.missing_declaration_names.length) {
      warnings.push(
        `${core.missing_declaration_names.length} råvare(r) mangler deklarasjonsnavn — innkjøpsnavnet brukes midlertidig: ${core.missing_declaration_names.map((m) => m.name).join(", ")}`,
      );
    }
    if (nutritionCoveragePct < 80) warnings.push(`Kun ${nutritionCoveragePct}% av vekten har næringsdekning`);
    if (breadscaleUnclassified.length) warnings.push(`Brødskala: ${breadscaleUnclassified.length} ingredienser ikke klassifisert`);

    // Modus + manuelle overstyringer
    const linkMode = link.declaration_mode;
    const recipeMode = recipe?.declaration_mode;
    const mode = linkMode ?? recipeMode ?? "auto";
    const modeSource: "link" | "recipe" | "default" = linkMode ? "link" : (recipeMode ? "recipe" : "default");

    let finalIngredient = core.ingredientHtml;
    let finalNutrition = per100 as Record<string, number | null>;
    let finalContains = core.containsList;
    let finalMayContain = core.mayContainList;

    function pickManual<T>(linkVal: T | null | undefined, recipeVal: T | null | undefined): T | null | undefined {
      return linkVal ?? recipeVal;
    }
    if (mode === "manual") {
      const ing = pickManual(link.manual_ingredient_declaration, recipe?.manual_ingredient_declaration);
      if (ing) finalIngredient = ing as string;
      const nut = pickManual(link.manual_nutrition, recipe?.manual_nutrition);
      if (nut && typeof nut === "object") finalNutrition = nut as any;
      const all = pickManual(link.manual_allergen_summary, recipe?.manual_allergen_summary);
      if (all && typeof all === "object") {
        const m = all as any;
        if (Array.isArray(m.contains)) finalContains = m.contains;
        if (Array.isArray(m.may_contain)) finalMayContain = m.may_contain;
      }
    } else if (mode === "auto_with_overrides") {
      const { data: overrides } = await service.from("product_declaration_overrides")
        .select("field_name, override_value").eq("product_recipe_link_id", linkId);
      for (const o of overrides ?? []) {
        if (o.field_name === "ingredient_declaration" && typeof o.override_value === "string") finalIngredient = o.override_value;
        else if (o.field_name === "nutrition" && o.override_value && typeof o.override_value === "object") finalNutrition = { ...finalNutrition, ...(o.override_value as any) };
        else if (o.field_name === "allergens_contains" && Array.isArray(o.override_value)) finalContains = o.override_value as string[];
        else if (o.field_name === "allergens_may_contain" && Array.isArray(o.override_value)) finalMayContain = o.override_value as string[];
        else if (o.field_name.startsWith("nutrition.")) {
          const key = o.field_name.split(".")[1];
          finalNutrition = { ...finalNutrition, [key]: o.override_value as number };
        }
      }
    }

    return new Response(JSON.stringify({
      mode, mode_source: modeSource,
      product_recipe_link_id: linkId, product_id: link.product_id, recipe_id: link.recipe_id,
      product_name: product?.display_name,
      total_input_grams: totalInputGrams, final_weight_grams: finalWeight,
      ingredient_declaration_html: finalIngredient,
      nutrition_per_100g: finalNutrition,
      allergens_contains: finalContains,
      allergens_may_contain: finalMayContain,
      breadscale: grainPct != null ? {
        pct: grainPct,
        category: grainCategory,
        total_flour_grams: totalFlour,
        coarse_grams_weighted: coarseWeighted,
        contributors: core.breadscale.contributors,
        unclassified: breadscaleUnclassified,
        flour_ratio_of_total: flourRatioOfTotal,
        classification_complete: breadscaleUnclassified.length === 0,
      } : null,
      data_quality: {
        lines_total: sortedAgg.length,
        master_lines: topLines.filter((t) => t.source === "master").length,
        extra_lines: topLines.filter((t) => t.source === "extra").length,
        composite_lines_unreviewed: core.composite_unreviewed.length,
        composite_lines_text_only: core.composite_text_only.length,
        lines_without_raw_material: linesWithoutRm,
        lines_without_nutrition: linesWithoutNut,
        nutrition_coverage_pct: nutritionCoveragePct,
        yield_grams_set: yieldGrams != null,
      },
      warnings,
      computed_lines: sortedAgg.map((a) => ({
        source: [...a.sources][0],
        name: a.name,
        grams: a.grams,
        effective_grams: a.effective_grams,
        include: true,
        is_quid: a.is_quid,
        raw_material_id: a.raw_material_id,
        has_nutrition: a.has_nutrition,
        from_composite: a.parent_ids.size > 0,
      })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("compute-product-declaration", e);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
