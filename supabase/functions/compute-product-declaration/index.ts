// Beregner næringsdeklarasjon, ingrediensliste og allergener PR PRODUKT-KOBLING.
// Tar med master-ingredienser (recipe_lines) + ekstra-linjer på koblingen (product_recipe_links.extra_lines).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLERGEN_LABEL: Record<string, string> = {
  gluten_wheat: "hvete", gluten_rye: "rug", gluten_barley: "bygg", gluten_oats: "havre", gluten_spelt: "spelt",
  crustaceans: "krepsdyr", fish: "fisk", molluscs: "bløtdyr",
  eggs: "egg", milk: "melk",
  peanuts: "peanøtter", nuts_almond: "mandler", nuts_hazelnut: "hasselnøtter", nuts_walnut: "valnøtter",
  nuts_cashew: "cashewnøtter", nuts_pecan: "pekannøtter", nuts_brazil: "paranøtter",
  nuts_pistachio: "pistasjenøtter", nuts_macadamia: "macadamianøtter",
  soybeans: "soya", celery: "selleri", mustard: "sennep", sesame: "sesamfrø",
  sulphites: "svoveldioksid og sulfitt", lupin: "lupin",
};

function toGrams(qty: number, unit: string, unitWeightG: number | null): number {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    let linkId: string | null = body.product_recipe_link_id ?? null;
    const productId: string | null = body.product_id ?? null;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Slå opp link via product_id hvis ikke gitt
    if (!linkId && productId) {
      const { data } = await service
        .from("product_recipe_links")
        .select("id")
        .eq("product_id", productId)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      linkId = data?.id ?? null;
    }
    if (!linkId) {
      return new Response(JSON.stringify({ error: "product_recipe_link_id or product_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // RLS-sjekk via userClient
    const { data: accessCheck } = await userClient.from("product_recipe_links").select("id").eq("id", linkId).maybeSingle();
    if (!accessCheck) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Hent kobling, master-oppskrift, produkt
    const { data: link, error: linkErr } = await service
      .from("product_recipe_links")
      .select(`
        id, product_id, recipe_id,
        extra_lines, yield_weight_g_override,
        declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary,
        products(id, display_name),
        recipes(id, declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary, yield_grams, yield_loss_pct)
      `)
      .eq("id", linkId)
      .maybeSingle();
    if (linkErr || !link) {
      return new Response(JSON.stringify({ error: "Link not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const recipe = (link as any).recipes;
    const product = (link as any).products;

    // Master-linjer
    const { data: masterLines } = await service
      .from("recipe_lines")
      .select("id, raw_material_id, ingredient_name, quantity, unit, waste_percent, include_in_declaration, is_quid_relevant, custom_declaration_text, sort_order, raw_materials(id, name, unit_weight_grams)")
      .eq("recipe_id", link.recipe_id)
      .order("sort_order");

    // Extra-linjer fra koblingen
    const extraLinesArr = Array.isArray(link.extra_lines) ? link.extra_lines as any[] : [];

    type Combined = {
      source: "master" | "extra";
      raw_material_id: string | null;
      name: string;
      quantity: number;
      unit: string;
      waste_percent: number;
      include: boolean;
      is_quid: boolean;
      custom_text: string | null;
      unit_weight_grams: number | null;
    };

    const combined: Combined[] = [];
    for (const l of masterLines ?? []) {
      const rm = (l as any).raw_materials;
      combined.push({
        source: "master",
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

    // Hent rm-meta for extra-linjer
    const extraRmIds = extraLinesArr.map((e) => e.raw_material_id).filter(Boolean);
    const extraRmMap = new Map<string, any>();
    if (extraRmIds.length) {
      const { data: rms } = await service
        .from("raw_materials")
        .select("id, name, unit_weight_grams")
        .in("id", extraRmIds);
      for (const r of rms ?? []) extraRmMap.set(r.id, r);
    }

    for (const e of extraLinesArr) {
      const rm = e.raw_material_id ? extraRmMap.get(e.raw_material_id) : null;
      combined.push({
        source: "extra",
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

    // Beregn gram pr linje
    const computed = combined.map((c) => {
      const grams = toGrams(c.quantity, c.unit, c.unit_weight_grams);
      const effective = grams * (1 - c.waste_percent / 100);
      return { ...c, grams, effective_grams: effective };
    });

    // Hent næring + allergener for alle rmIds
    const allRmIds = [...new Set(computed.map((c) => c.raw_material_id).filter(Boolean) as string[])];
    const [nutritionRes, allergenRes] = await Promise.all([
      service.from("raw_material_nutrition").select("*").in("raw_material_id", allRmIds.length ? allRmIds : ["00000000-0000-0000-0000-000000000000"]),
      service.from("raw_material_allergens").select("raw_material_id, allergen, presence").in("raw_material_id", allRmIds.length ? allRmIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const nutritionByRm = new Map<string, any>();
    for (const n of nutritionRes.data ?? []) nutritionByRm.set(n.raw_material_id, n);
    const allergensByRm = new Map<string, { allergen: string; presence: string }[]>();
    for (const a of allergenRes.data ?? []) {
      const arr = allergensByRm.get(a.raw_material_id) ?? [];
      arr.push({ allergen: a.allergen, presence: a.presence });
      allergensByRm.set(a.raw_material_id, arr);
    }

    const totalInputGrams = computed.reduce((s, l) => s + l.effective_grams, 0) || 1;
    const yieldGrams = link.yield_weight_g_override ?? recipe?.yield_grams ?? null;
    const yieldLoss = Number(recipe?.yield_loss_pct) || 0;
    const finalWeight = yieldGrams ?? (totalInputGrams * (1 - yieldLoss / 100)) || 1;

    // Ingrediensliste
    const declLines = computed
      .filter((l) => l.include && l.effective_grams > 0)
      .sort((a, b) => b.effective_grams - a.effective_grams);

    const allergenSet = new Set<string>();
    for (const l of declLines) {
      const al = l.raw_material_id ? allergensByRm.get(l.raw_material_id) ?? [] : [];
      for (const a of al) if (a.presence === "contains") allergenSet.add(a.allergen);
    }

    function renderIngredient(l: typeof declLines[number]): string {
      if (l.custom_text) return l.custom_text;
      const al = l.raw_material_id ? allergensByRm.get(l.raw_material_id) ?? [] : [];
      const containsAllergens = al.filter((a) => a.presence === "contains").map((a) => a.allergen);
      let display = l.name;
      for (const a of containsAllergens) {
        const label = ALLERGEN_LABEL[a];
        if (!label) continue;
        const re = new RegExp(`(${label})`, "i");
        if (re.test(display)) { display = display.replace(re, "<strong>$1</strong>"); break; }
      }
      if (l.is_quid) {
        const pct = Math.round((l.effective_grams / totalInputGrams) * 1000) / 10;
        display += ` ${pct}%`;
      }
      return display;
    }

    const ingredientHtml = declLines.map(renderIngredient).join(", ");

    const containsList = [...allergenSet].map((a) => ALLERGEN_LABEL[a] ?? a).sort();
    const mayContainSet = new Set<string>();
    for (const l of declLines) {
      const al = l.raw_material_id ? allergensByRm.get(l.raw_material_id) ?? [] : [];
      for (const a of al) {
        if (a.presence === "may_contain" && !allergenSet.has(a.allergen)) mayContainSet.add(a.allergen);
      }
    }
    const mayContainList = [...mayContainSet].map((a) => ALLERGEN_LABEL[a] ?? a).sort();

    // Næring
    const NUT_FIELDS = ["energy_kj","energy_kcal","fat_g","saturated_fat_g","carbs_g","sugars_g","fiber_g","protein_g","salt_g"] as const;
    const totals: Record<string, number> = {};
    let coveredGrams = 0;
    for (const l of computed) {
      if (!l.include) continue;
      const n = l.raw_material_id ? nutritionByRm.get(l.raw_material_id) : null;
      if (!n) continue;
      coveredGrams += l.effective_grams;
      for (const f of NUT_FIELDS) {
        const v = Number(n[f]);
        if (Number.isFinite(v)) totals[f] = (totals[f] ?? 0) + (v * l.effective_grams) / 100;
      }
    }
    const per100: Record<string, number | null> = {};
    for (const f of NUT_FIELDS) {
      per100[f] = totals[f] != null ? Math.round((totals[f] / finalWeight) * 1000) / 10 : null;
    }

    // Datakvalitet — split master vs extra
    const masterMissing = computed.filter((l) => l.source === "master" && l.raw_material_id && !nutritionByRm.get(l.raw_material_id)).length;
    const extraMissing = computed.filter((l) => l.source === "extra" && l.raw_material_id && !nutritionByRm.get(l.raw_material_id)).length;
    const masterNoRm = computed.filter((l) => l.source === "master" && !l.raw_material_id).length;
    const extraNoRm = computed.filter((l) => l.source === "extra" && !l.raw_material_id).length;
    const nutritionCoveragePct = Math.round((coveredGrams / (totalInputGrams || 1)) * 100);

    const warnings: string[] = [];
    if (yieldGrams == null) warnings.push("Mangler ferdigvekt (yield_grams) på både kobling og master — næring pr 100 g antar input-vekt");
    if (masterNoRm) warnings.push(`${masterNoRm} master-linje(r) mangler råvare-kobling`);
    if (extraNoRm) warnings.push(`${extraNoRm} ekstra-linje(r) mangler råvare-kobling`);
    if (masterMissing) warnings.push(`${masterMissing} master-råvare(r) mangler næringsdata`);
    if (extraMissing) warnings.push(`${extraMissing} ekstra-råvare(r) mangler næringsdata`);
    if (nutritionCoveragePct < 80) warnings.push(`Kun ${nutritionCoveragePct}% av vekten har næringsdekning`);

    // Modus + manuelle overstyringer (kobling vinner over master)
    const linkMode = link.declaration_mode;
    const recipeMode = recipe?.declaration_mode;
    const mode = linkMode ?? recipeMode ?? "auto";
    const modeSource: "link" | "recipe" | "default" = linkMode ? "link" : (recipeMode ? "recipe" : "default");

    let finalIngredient = ingredientHtml;
    let finalNutrition = per100 as Record<string, number | null>;
    let finalContains = containsList;
    let finalMayContain = mayContainList;

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
      const { data: overrides } = await service
        .from("product_declaration_overrides")
        .select("field_name, override_value")
        .eq("product_recipe_link_id", linkId);
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
      mode,
      mode_source: modeSource,
      product_recipe_link_id: linkId,
      product_id: link.product_id,
      recipe_id: link.recipe_id,
      product_name: product?.display_name,
      total_input_grams: totalInputGrams,
      final_weight_grams: finalWeight,
      ingredient_declaration_html: finalIngredient,
      nutrition_per_100g: finalNutrition,
      allergens_contains: finalContains,
      allergens_may_contain: finalMayContain,
      data_quality: {
        lines_total: computed.length,
        master_lines: computed.filter((l) => l.source === "master").length,
        extra_lines: computed.filter((l) => l.source === "extra").length,
        master_lines_without_raw_material: masterNoRm,
        extra_lines_without_raw_material: extraNoRm,
        master_lines_without_nutrition: masterMissing,
        extra_lines_without_nutrition: extraMissing,
        nutrition_coverage_pct: nutritionCoveragePct,
        yield_grams_set: yieldGrams != null,
      },
      warnings,
      computed_lines: computed.map((c) => ({
        source: c.source, name: c.name, grams: c.grams, effective_grams: c.effective_grams,
        include: c.include, is_quid: c.is_quid, raw_material_id: c.raw_material_id,
        has_nutrition: !!(c.raw_material_id && nutritionByRm.get(c.raw_material_id)),
      })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
