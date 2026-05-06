// Beregner næringsdeklarasjon, ingrediensliste og allergener for en oppskrift.
// Respekterer recipe.declaration_mode + recipe_declaration_overrides.
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
  if (u === "ml") return qty; // antar tetthet 1
  if (u === "l" || u === "liter") return qty * 1000;
  if (u === "stk") return qty * (unitWeightG ?? 0);
  return 0;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { recipe_id } = await req.json();
    if (!recipe_id || typeof recipe_id !== "string") {
      return new Response(JSON.stringify({ error: "recipe_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    // Hent oppskrift + linjer + råvare-meta
    const { data: recipe, error: recErr } = await service
      .from("recipes")
      .select("id, product_id, declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary, yield_loss_pct, products!inner(display_name, legal_entity_id)")
      .eq("id", recipe_id)
      .maybeSingle();
    if (recErr || !recipe) {
      return new Response(JSON.stringify({ error: "Recipe not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Tilgangskontroll: bruk userClient til å lese samme — RLS sjekker
    const { data: accessCheck } = await userClient.from("recipes").select("id").eq("id", recipe_id).maybeSingle();
    if (!accessCheck) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: lines } = await service
      .from("recipe_lines")
      .select("id, raw_material_id, ingredient_name, quantity, unit, waste_percent, include_in_declaration, is_quid_relevant, custom_declaration_text, sort_order, raw_materials(id, name, unit_weight_grams)")
      .eq("recipe_id", recipe_id)
      .order("sort_order");

    const linesArr = (lines ?? []) as any[];
    const rmIds = linesArr.map((l) => l.raw_material_id).filter(Boolean);

    const [nutritionRes, allergenRes] = await Promise.all([
      service.from("raw_material_nutrition").select("*").in("raw_material_id", rmIds.length ? rmIds : ["00000000-0000-0000-0000-000000000000"]),
      service.from("raw_material_allergens").select("raw_material_id, allergen, presence").in("raw_material_id", rmIds.length ? rmIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const nutritionByRm = new Map<string, any>();
    for (const n of nutritionRes.data ?? []) nutritionByRm.set(n.raw_material_id, n);
    const allergensByRm = new Map<string, { allergen: string; presence: string }[]>();
    for (const a of allergenRes.data ?? []) {
      const arr = allergensByRm.get(a.raw_material_id) ?? [];
      arr.push({ allergen: a.allergen, presence: a.presence });
      allergensByRm.set(a.raw_material_id, arr);
    }

    // Beregn gram pr linje
    const computed = linesArr.map((l) => {
      const rm = l.raw_materials;
      const grams = toGrams(Number(l.quantity) || 0, l.unit, rm?.unit_weight_grams ?? null);
      const wasteFactor = 1 - (Number(l.waste_percent) || 0) / 100;
      const effectiveGrams = grams * wasteFactor;
      const name = rm?.name ?? l.ingredient_name ?? "(ukjent)";
      return {
        line_id: l.id,
        raw_material_id: l.raw_material_id,
        name,
        grams,
        effective_grams: effectiveGrams,
        include: l.include_in_declaration !== false,
        is_quid: !!l.is_quid_relevant,
        custom_text: l.custom_declaration_text || null,
        nutrition: l.raw_material_id ? nutritionByRm.get(l.raw_material_id) ?? null : null,
        allergens: l.raw_material_id ? allergensByRm.get(l.raw_material_id) ?? [] : [],
      };
    });

    const totalInputGrams = computed.reduce((s, l) => s + l.effective_grams, 0) || 1;
    const yieldLoss = Number(recipe.yield_loss_pct) || 0;
    const finalWeight = totalInputGrams * (1 - yieldLoss / 100) || 1;

    // Ingrediensdeklarasjon (sortert desc på effektive gram)
    const declLines = computed
      .filter((l) => l.include && l.effective_grams > 0)
      .sort((a, b) => b.effective_grams - a.effective_grams);

    const allergenSet = new Set<string>(); // contains
    for (const l of declLines) {
      for (const a of l.allergens) {
        if (a.presence === "contains") allergenSet.add(a.allergen);
      }
    }

    function renderIngredient(l: typeof declLines[number]): string {
      if (l.custom_text) return l.custom_text;
      const containsAllergens = l.allergens.filter((a) => a.presence === "contains").map((a) => a.allergen);
      let display = l.name;
      // Bold første treff av en allergen-tekst i navnet
      for (const al of containsAllergens) {
        const label = ALLERGEN_LABEL[al];
        if (!label) continue;
        const re = new RegExp(`(${label})`, "i");
        if (re.test(display)) {
          display = display.replace(re, "<strong>$1</strong>");
          break;
        }
      }
      // QUID-prosent (basert på input-vekt)
      if (l.is_quid) {
        const pct = Math.round((l.effective_grams / totalInputGrams) * 1000) / 10;
        display += ` ${pct}%`;
      }
      return display;
    }

    const ingredientHtml = declLines.map(renderIngredient).join(", ");

    // Allergen-summary
    const containsList = [...allergenSet].map((a) => ALLERGEN_LABEL[a] ?? a).sort();
    const mayContainSet = new Set<string>();
    for (const l of declLines) {
      for (const a of l.allergens) {
        if (a.presence === "may_contain" && !allergenSet.has(a.allergen)) {
          mayContainSet.add(a.allergen);
        }
      }
    }
    const mayContainList = [...mayContainSet].map((a) => ALLERGEN_LABEL[a] ?? a).sort();

    // Næring pr 100g — aggregert vektet på grams
    const NUT_FIELDS = ["energy_kj","energy_kcal","fat_g","saturated_fat_g","carbs_g","sugars_g","fiber_g","protein_g","salt_g"] as const;
    const totals: Record<string, number> = {};
    let coveredGrams = 0;
    for (const l of computed) {
      if (!l.include || !l.nutrition) continue;
      coveredGrams += l.effective_grams;
      for (const f of NUT_FIELDS) {
        const v = Number(l.nutrition[f]);
        if (Number.isFinite(v)) {
          totals[f] = (totals[f] ?? 0) + (v * l.effective_grams) / 100;
        }
      }
    }
    const per100: Record<string, number | null> = {};
    for (const f of NUT_FIELDS) {
      per100[f] = totals[f] != null ? Math.round((totals[f] / finalWeight) * 1000) / 10 : null;
    }

    // Datakvalitet
    const linesWithoutRm = computed.filter((l) => !l.raw_material_id).length;
    const linesWithoutNutrition = computed.filter((l) => l.raw_material_id && !l.nutrition).length;
    const linesWithoutAllergens = computed.filter((l) => l.raw_material_id && (!allergensByRm.get(l.raw_material_id) || allergensByRm.get(l.raw_material_id)!.length === 0)).length;
    const nutritionCoveragePct = Math.round((coveredGrams / (totalInputGrams || 1)) * 100);

    const warnings: string[] = [];
    if (linesWithoutRm > 0) warnings.push(`${linesWithoutRm} linje(r) mangler råvare-kobling`);
    if (linesWithoutNutrition > 0) warnings.push(`${linesWithoutNutrition} råvare(r) mangler næringsdata`);
    if (nutritionCoveragePct < 80) warnings.push(`Kun ${nutritionCoveragePct}% av vekten har næringsdekning`);

    // Manual mode — overstyr alt
    let mode = recipe.declaration_mode || "auto";
    let finalIngredient = ingredientHtml;
    let finalNutrition = per100;
    let finalContains = containsList;
    let finalMayContain = mayContainList;

    if (mode === "manual") {
      if (recipe.manual_ingredient_declaration) finalIngredient = recipe.manual_ingredient_declaration;
      if (recipe.manual_nutrition && typeof recipe.manual_nutrition === "object") finalNutrition = recipe.manual_nutrition as any;
      if (recipe.manual_allergen_summary && typeof recipe.manual_allergen_summary === "object") {
        const m = recipe.manual_allergen_summary as any;
        if (Array.isArray(m.contains)) finalContains = m.contains;
        if (Array.isArray(m.may_contain)) finalMayContain = m.may_contain;
      }
    } else if (mode === "auto_with_overrides") {
      const { data: overrides } = await service
        .from("recipe_declaration_overrides")
        .select("field_name, override_value")
        .eq("recipe_id", recipe_id);
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
      product_name: (recipe as any).products?.display_name,
      total_input_grams: totalInputGrams,
      final_weight_grams: finalWeight,
      ingredient_declaration_html: finalIngredient,
      nutrition_per_100g: finalNutrition,
      allergens_contains: finalContains,
      allergens_may_contain: finalMayContain,
      data_quality: {
        lines_total: computed.length,
        lines_without_raw_material: linesWithoutRm,
        lines_without_nutrition: linesWithoutNutrition,
        lines_without_allergens: linesWithoutAllergens,
        nutrition_coverage_pct: nutritionCoveragePct,
      },
      warnings,
      computed_lines: computed.map((c) => ({
        line_id: c.line_id, name: c.name, grams: c.grams, effective_grams: c.effective_grams,
        include: c.include, is_quid: c.is_quid, has_nutrition: !!c.nutrition, allergen_count: c.allergens.length,
        raw_material_id: c.raw_material_id,
      })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
