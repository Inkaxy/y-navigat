// Beregner deklarasjon, allergener og næring PR PRODUKT-KOBLING.
// - Master + extra-linjer slås sammen
// - Sammensatte råvarer dekomponeres rekursivt og aggregeres på komponent-nivå
// - QUID rangerer på samlet mengde
// - Brødskala'n beregnes og caches
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

function normName(s: string): string {
  return s.toLowerCase().trim().replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ");
}

const BRAN_FACTOR: Record<string, number> = {
  wheat_bran: 4.5, rye_bran: 4.0, oat_bran: 2.0,
};

function breadscaleCategory(pct: number): string {
  if (pct < 26) return "fint";
  if (pct < 51) return "halvgrovt";
  if (pct < 76) return "grovt";
  return "ekstra_grovt";
}

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

    type TopLine = {
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
    };

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

    // Komponenter for sammensatte råvarer (rekursivt, maks 3 nivåer)
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

    // Initial: last komponenter for top-line composites
    const initialCompositeIds = topLines
      .filter((t) => t.raw_material?.is_composite && t.raw_material_id)
      .map((t) => t.raw_material_id as string);
    await loadComponentsFor(initialCompositeIds);

    type FlatLine = {
      source: "master" | "extra";
      key: string;                       // aggregeringsnøkkel
      raw_material_id: string | null;
      name: string;
      effective_grams: number;
      grams: number;
      include: boolean;
      is_quid: boolean;
      custom_text: string | null;
      from_composite_parent_id: string | null;  // hvilken parent denne stammer fra (eller null)
      grain_classification: string | null;
      allergens: string[];               // contains
      may_allergens: string[];
      has_nutrition: boolean;
    };

    const composite_unreviewed: string[] = [];
    const composite_text_only: string[] = [];

    // Hent allergener + næring (inkl. potensielle komponent-rm-ider)
    // Samle alle rmIds vi vil trenge
    const collectedRmIds = new Set<string>();
    function collectFromComponents(rmId: string, depth: number) {
      if (depth > 3) return;
      const comps = componentsByParent.get(rmId) ?? [];
      for (const c of comps) {
        if (c.component_raw_material_id) {
          collectedRmIds.add(c.component_raw_material_id);
        }
      }
    }
    for (const t of topLines) {
      if (t.raw_material_id) collectedRmIds.add(t.raw_material_id);
      if (t.raw_material?.is_composite && t.raw_material_id) collectFromComponents(t.raw_material_id, 0);
    }

    // Last komponenter for nivå 2
    const level2Ids: string[] = [];
    for (const id of collectedRmIds) {
      const comps = componentsByParent.get(id);
      if (comps === undefined) level2Ids.push(id);
    }
    if (level2Ids.length) {
      const { data: l2 } = await service.from("raw_materials").select("id, is_composite").in("id", level2Ids);
      const compositeChildIds = (l2 ?? []).filter((r) => r.is_composite).map((r) => r.id);
      if (compositeChildIds.length) {
        await loadComponentsFor(compositeChildIds);
        for (const id of compositeChildIds) collectFromComponents(id, 1);
      }
    }

    // Hent meta for ALLE rmIds
    const allRmIds = [...collectedRmIds];
    const [rmRes, nutritionRes, allergenRes] = await Promise.all([
      allRmIds.length ? service.from("raw_materials").select("id, name, is_composite, grain_classification, components_reviewed_at, unit_weight_grams").in("id", allRmIds) : { data: [] },
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

    // Dekomponer rekursivt
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
    ): FlatLine[] {
      const rm = rmId ? rmMap.get(rmId) ?? null : null;
      const isComposite = rm?.is_composite && depth < 3;
      if (!isComposite) {
        const allergens = rmId ? (allergensByRm.get(rmId) ?? []).filter((a) => a.presence === "contains").map((a) => a.allergen) : [];
        const may = rmId ? (allergensByRm.get(rmId) ?? []).filter((a) => a.presence === "may_contain").map((a) => a.allergen) : [];
        const key = rmId ? `rm:${rmId}` : `text:${normName(fallbackName)}`;
        return [{
          source,
          key,
          raw_material_id: rmId,
          name: rm?.name ?? fallbackName,
          grams,
          effective_grams,
          include: true,
          is_quid: isQuid,
          custom_text: customText,
          from_composite_parent_id: parentChain,
          grain_classification: rm?.grain_classification ?? null,
          allergens,
          may_allergens: may,
          has_nutrition: rmId ? !!nutritionByRm.get(rmId) : false,
        }];
      }
      // composite
      if (rmId && (!rm?.components_reviewed_at)) {
        if (!composite_unreviewed.includes(rm?.name ?? rmId)) composite_unreviewed.push(rm?.name ?? rmId);
      }
      const comps = (componentsByParent.get(rmId!) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
      const out: FlatLine[] = [];
      const totalPct = comps.reduce((s, c) => s + Number(c.percentage), 0) || 100;
      for (const c of comps) {
        const ratio = Number(c.percentage) / totalPct;
        const childGrams = grams * ratio;
        const childEff = effective_grams * ratio;
        if (c.component_raw_material_id) {
          out.push(...decompose(source, childGrams, childEff, c.component_raw_material_id, "(komponent)", c.is_quid_relevant || isQuid, null, depth + 1, rmId));
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
            include: true,
            is_quid: c.is_quid_relevant || isQuid,
            custom_text: null,
            from_composite_parent_id: rmId,
            grain_classification: null,
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
        // Fritekst-overstyring beholdes som én linje (ikke aggregert)
        flatLines.push({
          source: t.source, key: `text:${normName(t.custom_text)}`,
          raw_material_id: t.raw_material_id, name: t.name,
          grams, effective_grams: effective, include: true,
          is_quid: t.is_quid, custom_text: t.custom_text,
          from_composite_parent_id: null, grain_classification: t.raw_material?.grain_classification ?? null,
          allergens: [], may_allergens: [], has_nutrition: t.raw_material_id ? !!nutritionByRm.get(t.raw_material_id) : false,
        });
        continue;
      }
      flatLines.push(...decompose(t.source, grams, effective, t.raw_material_id, t.name, t.is_quid, null, 0, null));
    }

    // Aggregér på key
    type Agg = {
      key: string;
      raw_material_id: string | null;
      name: string;
      effective_grams: number;
      grams: number;
      is_quid: boolean;
      custom_text: string | null;
      grain_classification: string | null;
      allergens: Set<string>;
      may_allergens: Set<string>;
      has_nutrition: boolean;
      sources: Set<"master" | "extra">;
      parent_ids: Set<string>;
    };
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
      } else {
        aggMap.set(l.key, {
          key: l.key, raw_material_id: l.raw_material_id, name: l.name,
          effective_grams: l.effective_grams, grams: l.grams, is_quid: l.is_quid, custom_text: l.custom_text,
          grain_classification: l.grain_classification,
          allergens: new Set(l.allergens), may_allergens: new Set(l.may_allergens),
          has_nutrition: l.has_nutrition, sources: new Set([l.source]),
          parent_ids: new Set(l.from_composite_parent_id ? [l.from_composite_parent_id] : []),
        });
      }
    }

    const totalInputGrams = [...aggMap.values()].reduce((s, l) => s + l.effective_grams, 0) || 1;
    const yieldGrams = link.yield_weight_g_override ?? recipe?.yield_grams ?? null;
    const yieldLoss = Number(recipe?.yield_loss_pct) || 0;
    const finalWeight = (yieldGrams ?? (totalInputGrams * (1 - yieldLoss / 100))) || 1;

    // Sortér aggregert desc
    const sortedAgg = [...aggMap.values()].sort((a, b) => b.effective_grams - a.effective_grams);

    // Bestem hvilke parents som kan rendres "wrap" (alle deres komponenter har eksklusivt én parent og er ikke aggregert med andre)
    const parentToChildren = new Map<string, Agg[]>();
    for (const a of sortedAgg) {
      if (a.parent_ids.size === 1) {
        const pid = [...a.parent_ids][0];
        // Komponenten må stamme fra KUN denne parent (ingen aggregering med fritt-stående eller annen parent)
        const arr = parentToChildren.get(pid) ?? [];
        arr.push(a);
        parentToChildren.set(pid, arr);
      }
    }
    // Disqualify parents whose children also exist outside this parent
    const wrapParents = new Set<string>();
    for (const [pid, kids] of parentToChildren.entries()) {
      const allExclusive = kids.every((k) => k.parent_ids.size === 1);
      if (allExclusive && kids.length > 0) wrapParents.add(pid);
    }

    // Bygg ingrediens-render: gå gjennom sortedAgg, men hopp over de som tilhører wrapParent (de skal vises inni parent)
    const renderedKeys = new Set<string>();
    function escapeHtml(s: string): string {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    function renderItem(a: Agg, includeQuid: boolean): string {
      if (a.custom_text) return escapeHtml(a.custom_text);
      let display = escapeHtml(a.name);
      for (const al of a.allergens) {
        const label = ALLERGEN_LABEL[al]; if (!label) continue;
        const re = new RegExp(`(${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i");
        if (re.test(display)) { display = display.replace(re, "<strong>$1</strong>"); break; }
      }
      if (includeQuid && a.is_quid) {
        const pct = Math.round((a.effective_grams / totalInputGrams) * 1000) / 10;
        display += ` ${pct}%`;
      }
      return display;
    }

    const ingredientParts: string[] = [];
    // Map fra parent_id → posisjon i sortedAgg (den største komponenten avgjør hvor wrap rendres)
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
      // Hvis denne agg er del av en wrap-parent og vi er ved første pos
      let wrapped = false;
      if (a.parent_ids.size === 1) {
        const pid = [...a.parent_ids][0];
        if (wrapParents.has(pid) && parentFirstPos.get(pid) === i) {
          const parentRm = rmMap.get(pid);
          const parentName = parentRm?.name ?? "Sammensatt";
          const kids = (parentToChildren.get(pid) ?? []).slice().sort((x, y) => y.effective_grams - x.effective_grams);
          for (const k of kids) renderedKeys.add(k.key);
          ingredientParts.push(`${parentName} (${kids.map((k) => renderItem(k, false)).join(", ")})`);
          wrapped = true;
        } else if (wrapParents.has(pid)) {
          // Skip — render in wrap
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

    // Næring fra dekomponerte linjer
    const NUT_FIELDS = ["energy_kj","energy_kcal","fat_g","saturated_fat_g","carbs_g","sugars_g","fiber_g","protein_g","salt_g"] as const;
    const totals: Record<string, number> = {};
    let coveredGrams = 0;
    for (const a of sortedAgg) {
      const n = a.raw_material_id ? nutritionByRm.get(a.raw_material_id) : null;
      if (!n) continue;
      coveredGrams += a.effective_grams;
      for (const f of NUT_FIELDS) {
        const v = Number(n[f]);
        if (Number.isFinite(v)) totals[f] = (totals[f] ?? 0) + (v * a.effective_grams) / 100;
      }
    }
    const per100: Record<string, number | null> = {};
    for (const f of NUT_FIELDS) {
      per100[f] = totals[f] != null ? Math.round((totals[f] / finalWeight) * 1000) / 10 : null;
    }

    // Brødskala'n
    let totalFlour = 0, coarseWeighted = 0;
    const breadscaleContrib: Array<{ name: string; grams: number; classification: string; weighted: number }> = [];
    const breadscaleUnclassified: string[] = [];
    for (const a of sortedAgg) {
      const c = a.grain_classification;
      const g = a.effective_grams;
      if (c === "sifted_flour" || c === "other_flour") {
        totalFlour += g;
        breadscaleContrib.push({ name: a.name, grams: g, classification: c, weighted: 0 });
      } else if (c === "whole_grain_flour" || c === "whole_grains" || c === "gluten_free_grain") {
        totalFlour += g; coarseWeighted += g;
        breadscaleContrib.push({ name: a.name, grams: g, classification: c, weighted: g });
      } else if (c === "wheat_bran" || c === "rye_bran" || c === "oat_bran") {
        const w = g * BRAN_FACTOR[c];
        coarseWeighted += w;
        breadscaleContrib.push({ name: a.name, grams: g, classification: c, weighted: w });
      } else if (c === "not_grain") {
        // skip
      } else {
        // Unknown — only flag if name suggests grain? For now: include only if it's likely grain by virtue of agg presence.
        // Skip — but keep a list of unclassified non-trivial items (those > 5g) for reporting.
        if (g > 5 && !a.custom_text) breadscaleUnclassified.push(a.name);
      }
    }
    const grainPct = totalFlour > 0 ? Math.round((coarseWeighted / totalFlour) * 1000) / 10 : null;
    const grainCategory = grainPct != null ? breadscaleCategory(grainPct) : null;
    const flourRatioOfTotal = totalInputGrams > 0 ? totalFlour / totalInputGrams : 0;

    // Cache
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
    const nutritionCoveragePct = Math.round((coveredGrams / (totalInputGrams || 1)) * 100);

    const warnings: string[] = [];
    if (yieldGrams == null) warnings.push("Mangler ferdigvekt — næring pr 100 g antar input-vekt");
    if (linesWithoutRm) warnings.push(`${linesWithoutRm} aggregert(e) ingrediens(er) mangler råvare-kobling`);
    if (linesWithoutNut) warnings.push(`${linesWithoutNut} råvare(r) mangler næringsdata`);
    if (composite_unreviewed.length) warnings.push(`Sammensatt råvare uten review: ${composite_unreviewed.join(", ")}`);
    if (composite_text_only.length) warnings.push(`${composite_text_only.length} komponent(er) er fritekst (uten råvare-kobling)`);
    if (nutritionCoveragePct < 80) warnings.push(`Kun ${nutritionCoveragePct}% av vekten har næringsdekning`);
    if (breadscaleUnclassified.length) warnings.push(`Brødskala: ${breadscaleUnclassified.length} ingredienser ikke klassifisert`);

    // Modus + manuelle overstyringer
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
        contributors: breadscaleContrib,
        unclassified: breadscaleUnclassified,
        flour_ratio_of_total: flourRatioOfTotal,
        classification_complete: breadscaleUnclassified.length === 0,
      } : null,
      data_quality: {
        lines_total: sortedAgg.length,
        master_lines: topLines.filter((t) => t.source === "master").length,
        extra_lines: topLines.filter((t) => t.source === "extra").length,
        composite_lines_unreviewed: composite_unreviewed.length,
        composite_lines_text_only: composite_text_only.length,
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
