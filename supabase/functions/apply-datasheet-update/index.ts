// Anvender et bekreftet datablad: oppdaterer råvare-felter, logger changelog, flagger berørte produkter
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ApplyBody {
  datasheet_id: string;
  raw_material_id: string;
  accepted_fields: string[]; // hvilke felter brukeren godtar: nutrition, allergens, ingredient_declaration, composite, grain, package
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json() as ApplyBody;
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const service = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: ds, error: dsErr } = await service.from("raw_material_datasheets").select("*").eq("id", body.datasheet_id).maybeSingle();
    if (dsErr || !ds) return json({ error: "Datasheet not found" }, 404);
    const ext = ds.ai_extracted ?? {};

    const { data: rm } = await service.from("raw_materials").select("*").eq("id", body.raw_material_id).maybeSingle();
    if (!rm) return json({ error: "Raw material not found" }, 404);

    const accepts = new Set(body.accepted_fields ?? []);
    const changelogRows: any[] = [];

    // Næring
    if (accepts.has("nutrition") && ext.nutrition) {
      const { data: oldNut } = await service.from("raw_material_nutrition").select("*").eq("raw_material_id", rm.id).maybeSingle();
      const newNut = {
        raw_material_id: rm.id,
        ...ext.nutrition,
        source: "leverandør_db",
        source_document_url: ds.file_path,
        verified_at: new Date().toISOString(),
        verified_by: userId,
      };
      await service.from("raw_material_nutrition").upsert(newNut);
      // Diff
      const fields = ["energy_kj","energy_kcal","fat_g","saturated_fat_g","carbs_g","sugars_g","fiber_g","protein_g","salt_g"];
      for (const f of fields) {
        const oldV = oldNut?.[f] ?? null;
        const newV = ext.nutrition[f] ?? null;
        if (oldV !== newV && newV !== null) {
          const sev = oldV !== null && Math.abs(((newV - oldV) / Math.max(0.01, oldV)) * 100) > 10 ? "medium" : "low";
          changelogRows.push({
            raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
            change_type: "nutrition_changed", field: f, old_value: oldV, new_value: newV,
            severity: sev, created_by: userId,
          });
        }
      }
    }

    // Allergener
    if (accepts.has("allergens") && Array.isArray(ext.allergens)) {
      const { data: oldAll } = await service.from("raw_material_allergens").select("allergen, presence").eq("raw_material_id", rm.id);
      const oldMap = new Map((oldAll ?? []).map((a: any) => [a.allergen, a.presence]));
      for (const a of ext.allergens) {
        await service.from("raw_material_allergens").upsert({
          raw_material_id: rm.id, allergen: a.allergen, presence: a.presence,
        }, { onConflict: "raw_material_id,allergen" });
        if (!oldMap.has(a.allergen)) {
          changelogRows.push({
            raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
            change_type: "allergen_added", field: a.allergen, old_value: null, new_value: a.presence,
            severity: a.presence === "contains" ? "high" : "medium", created_by: userId,
          });
        }
      }
    }

    // Ingrediensdeklarasjon (separat fra full nutrition for å unngå overskriv)
    if (accepts.has("ingredient_declaration") && ext.ingredient_declaration) {
      const { data: oldNut } = await service.from("raw_material_nutrition").select("ingredient_declaration").eq("raw_material_id", rm.id).maybeSingle();
      if (oldNut?.ingredient_declaration !== ext.ingredient_declaration) {
        await service.from("raw_material_nutrition").upsert({
          raw_material_id: rm.id, ingredient_declaration: ext.ingredient_declaration,
        });
        changelogRows.push({
          raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
          change_type: "composition_changed", field: "ingredient_declaration",
          old_value: oldNut?.ingredient_declaration ?? null, new_value: ext.ingredient_declaration,
          severity: "medium", created_by: userId,
        });
      }
    }

    // Sammensatte komponenter
    if (accepts.has("composite") && Array.isArray(ext.composite_components) && ext.composite_components.length > 0) {
      await service.from("raw_material_components").delete().eq("parent_raw_material_id", rm.id);
      const rows = ext.composite_components.map((c: any, i: number) => ({
        parent_raw_material_id: rm.id,
        primary_ingredient_name: c.name,
        percentage: Math.max(0.01, Math.min(100, Number(c.percentage) || 1)),
        is_explicit_percentage: c.percentage != null,
        sort_order: i,
        suggested_by_ai: true,
        needs_review: true,
      }));
      await service.from("raw_material_components").insert(rows);
      await service.from("raw_materials").update({ is_composite: true }).eq("id", rm.id);
      changelogRows.push({
        raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
        change_type: "composition_changed", field: "components",
        old_value: null, new_value: rows.map((r: any) => r.primary_ingredient_name),
        severity: "medium", created_by: userId,
      });
    }

    // Brødskala
    if (accepts.has("grain") && ext.grain_classification_hint) {
      if (rm.grain_classification !== ext.grain_classification_hint) {
        await service.from("raw_materials").update({ grain_classification: ext.grain_classification_hint }).eq("id", rm.id);
        changelogRows.push({
          raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
          change_type: "grain_changed", field: "grain_classification",
          old_value: rm.grain_classification, new_value: ext.grain_classification_hint,
          severity: "low", created_by: userId,
        });
      }
    }

    // Pakning
    if (accepts.has("package") && ext.package_size_value) {
      if (Number(rm.package_size) !== Number(ext.package_size_value) || rm.package_unit !== ext.package_size_unit) {
        await service.from("raw_materials").update({
          package_size: ext.package_size_value, package_unit: ext.package_size_unit,
        }).eq("id", rm.id);
        changelogRows.push({
          raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
          change_type: "package_changed", field: "package_size",
          old_value: { size: rm.package_size, unit: rm.package_unit },
          new_value: { size: ext.package_size_value, unit: ext.package_size_unit },
          severity: "low", created_by: userId,
        });
      }
    }

    // Finn berørte oppskrifter/produkter
    const { data: affectedRecipes } = await service.from("recipe_lines")
      .select("recipe_id").eq("raw_material_id", rm.id);
    const recipeIds = Array.from(new Set((affectedRecipes ?? []).map((r: any) => r.recipe_id)));
    let affectedProductIds: string[] = [];
    if (recipeIds.length > 0) {
      const { data: links } = await service.from("product_recipe_links")
        .select("product_id").in("recipe_id", recipeIds);
      affectedProductIds = Array.from(new Set((links ?? []).map((l: any) => l.product_id)));
      if (affectedProductIds.length > 0) {
        await service.from("products").update({
          declaration_needs_review: true,
          declaration_review_reason: `Råvare "${rm.name}" oppdatert fra datablad`,
        }).in("id", affectedProductIds);
      }
    }

    // Sett affected_recipes_count på changelog
    changelogRows.forEach(r => { r.affected_recipes_count = recipeIds.length; });
    if (changelogRows.length > 0) {
      await service.from("raw_material_changelog").insert(changelogRows);
    }

    // Marker datablad som anvendt og current
    await service.from("raw_material_datasheets").update({ is_current: false })
      .eq("raw_material_id", rm.id).eq("is_current", true);
    await service.from("raw_material_datasheets").update({
      status: "applied", is_current: true, raw_material_id: rm.id,
    }).eq("id", ds.id);

    return json({
      changes_logged: changelogRows.length,
      affected_recipes: recipeIds.length,
      affected_products: affectedProductIds.length,
    });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
