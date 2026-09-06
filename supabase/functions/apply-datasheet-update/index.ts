// Anvender et bekreftet datablad: oppdaterer råvare-felter, logger changelog, flagger berørte produkter
//
// Prinsipper etter kontrollrunden 2026-09-06:
//  * Ingen skriving ignoreres. Alt som feiler samles i `failures`, og databladet
//    merkes bare `applied` når ingenting feilet.
//  * Allergener valideres FØR noe slettes. Er AI-forslaget ufullstendig eller
//    inneholder ukjente koder, fjernes ingen eksisterende allergener.
//  * Fjerning av allergener krever eksplisitt menneskelig godkjenning
//    (`allergen_removals` i accepted_fields).
//  * Brukerens felt-for-felt-valg på næring håndheves her, ikke bare i UI.
//  * Pakningsstørrelse skrives ikke herfra — den går gjennom
//    `set_raw_material_package` (SetPackageDialog), som også regner om kostpris.
//
// Gjenstår (krever databaseendring, bevisst ikke gjort her): hele operasjonen
// er ikke transaksjonell. En feil midtveis kan etterlate delvis anvendte
// endringer. En transaksjons-RPC (`apply_datasheet_update(...)` i Postgres)
// bør ta over skrivingene når det åpnes for nye databaseobjekter.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { diffAllergens } from "../_shared/allergen-diff.ts";

const NUTRITION_FIELDS = [
  "energy_kj", "energy_kcal", "fat_g", "saturated_fat_g",
  "carbs_g", "sugars_g", "fiber_g", "protein_g", "salt_g",
] as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ApplyBody {
  datasheet_id: string;
  raw_material_id: string;
  /** nutrition, allergens, allergen_removals, ingredient_declaration, composite, grain */
  accepted_fields: string[];
  /** Delmengde av NUTRITION_FIELDS brukeren har huket av. Utelatt = alle med verdi. */
  accepted_nutrition_fields?: string[];
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

    const { data: rm, error: rmErr } = await service.from("raw_materials").select("*").eq("id", body.raw_material_id).maybeSingle();
    if (rmErr) return json({ error: "Kunne ikke lese råvaren" }, 500);
    if (!rm) return json({ error: "Raw material not found" }, 404);

    if (!ds.legal_entity_id || !rm.legal_entity_id || ds.legal_entity_id !== rm.legal_entity_id) {
      return json({ error: "Datablad og råvare tilhører ikke samme selskap" }, 403);
    }
    const { data: hasWrite, error: accessErr } = await userClient.rpc("has_ravarer_access", {
      _user_id: userId,
      _legal_entity_id: rm.legal_entity_id,
      _min_level: "write",
    });
    if (accessErr) return json({ error: "Kunne ikke kontrollere tilgang" }, 500);
    if (!hasWrite) return json({ error: "Ingen tilgang" }, 403);

    const accepts = new Set(body.accepted_fields ?? []);
    // deno-lint-ignore no-explicit-any
    const changelogRows: any[] = [];
    /** Alt som feilet. Ikke-tom = databladet merkes ikke som anvendt. */
    const failures: string[] = [];
    /** Ting brukeren må gjøre i en annen flyt (f.eks. pakning). */
    const followUps: Record<string, unknown> = {};

    // ---------------- Næring ----------------
    if (accepts.has("nutrition") && ext.nutrition) {
      const { data: oldNut, error: oldNutErr } = await service
        .from("raw_material_nutrition").select("*").eq("raw_material_id", rm.id).maybeSingle();
      if (oldNutErr) {
        failures.push(`næring (lesing): ${oldNutErr.message}`);
      } else {
        // Brukerens avhuking styrer hvilke felt som skrives. Fravalgte felt
        // røres ikke, heller ikke indirekte gjennom upserten.
        const chosen = Array.isArray(body.accepted_nutrition_fields)
          ? new Set(body.accepted_nutrition_fields)
          : null;
        const nutritionValues: Record<string, unknown> = {};
        const writtenFields: string[] = [];
        for (const f of NUTRITION_FIELDS) {
          if (ext.nutrition[f] == null) continue;
          if (chosen && !chosen.has(f)) continue;
          nutritionValues[f] = ext.nutrition[f];
          writtenFields.push(f);
        }

        const eNumbers = Array.isArray(ext.e_numbers)
          ? ext.e_numbers.map((e: unknown) => String(e).trim()).filter(Boolean)
          : null;
        const newNut: Record<string, unknown> = {
          raw_material_id: rm.id,
          ...nutritionValues,
          // Kanonisk kilde-vokabular: 'datablad' (tidligere 'leverandør_db').
          source: "datablad",
          source_document_url: ds.file_path,
          verified_at: new Date().toISOString(),
          verified_by: userId,
        };
        if (eNumbers && eNumbers.length > 0) newNut.e_numbers = eNumbers;
        if (ext.country_of_origin) newNut.country_of_origin = String(ext.country_of_origin).trim();

        const { error: upErr } = await service.from("raw_material_nutrition")
          .upsert(newNut, { onConflict: "raw_material_id" });
        if (upErr) {
          failures.push(`næring: ${upErr.message}`);
        } else {
          if (eNumbers && eNumbers.length > 0 && JSON.stringify(oldNut?.e_numbers ?? null) !== JSON.stringify(eNumbers)) {
            changelogRows.push({
              raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
              change_type: "composition_changed", field: "e_numbers",
              old_value: oldNut?.e_numbers ?? null, new_value: eNumbers,
              severity: "low", created_by: userId,
            });
          }
          if (ext.country_of_origin && oldNut?.country_of_origin !== ext.country_of_origin) {
            changelogRows.push({
              raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
              change_type: "composition_changed", field: "country_of_origin",
              old_value: oldNut?.country_of_origin ?? null, new_value: ext.country_of_origin,
              severity: "low", created_by: userId,
            });
          }
          for (const f of writtenFields) {
            const oldV = oldNut?.[f] ?? null;
            const newV = ext.nutrition[f] ?? null;
            if (oldV !== newV && newV !== null) {
              const sev = oldV !== null && Math.abs(((newV - oldV) / Math.max(0.01, Math.abs(oldV))) * 100) > 10 ? "medium" : "low";
              changelogRows.push({
                raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
                change_type: "nutrition_changed", field: f, old_value: oldV, new_value: newV,
                severity: sev, created_by: userId,
              });
            }
          }
        }
      }
    }

    // ---------------- Allergener ----------------
    if (accepts.has("allergens") && Array.isArray(ext.allergens)) {
      const { data: oldAll, error: oldAllErr } = await service
        .from("raw_material_allergens").select("allergen, presence").eq("raw_material_id", rm.id);
      if (oldAllErr) {
        failures.push(`allergener (lesing): ${oldAllErr.message}`);
      } else {
        const diff = diffAllergens((oldAll ?? []) as { allergen: string; presence: string }[], ext.allergens);
        // Er noe i AI-forslaget ugyldig, kan vi ikke stole på at listen er
        // komplett — da fjernes ingenting, uansett hva brukeren huket av.
        const extractionTrusted = diff.rejected.length === 0;
        const mayRemove = accepts.has("allergen_removals") && extractionTrusted;

        for (const a of [...diff.added, ...diff.changed.map((c) => ({ allergen: c.allergen, presence: c.to }))]) {
          const { error: aErr } = await service.from("raw_material_allergens").upsert({
            raw_material_id: rm.id, allergen: a.allergen, presence: a.presence,
          }, { onConflict: "raw_material_id,allergen" });
          if (aErr) {
            console.error("allergen upsert", a.allergen, aErr.message);
            failures.push(`allergen ${a.allergen}: ${aErr.message}`);
            continue;
          }
          changelogRows.push({
            raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
            change_type: "allergen_added", field: a.allergen,
            old_value: diff.changed.find((c) => c.allergen === a.allergen)?.from ?? null,
            new_value: a.presence,
            severity: a.presence === "contains" ? "high" : "medium", created_by: userId,
          });
        }

        if (diff.removed.length > 0) {
          if (!mayRemove) {
            followUps.allergen_removals_skipped = diff.removed.map((r) => r.allergen);
          } else {
            for (const r of diff.removed) {
              const { error: delErr } = await service.from("raw_material_allergens")
                .delete().eq("raw_material_id", rm.id).eq("allergen", r.allergen);
              if (delErr) {
                failures.push(`allergen ${r.allergen} (fjerning): ${delErr.message}`);
                continue;
              }
              changelogRows.push({
                raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
                change_type: "allergen_removed", field: r.allergen, old_value: r.presence, new_value: null,
                severity: "high", created_by: userId,
              });
            }
          }
        }

        if (diff.rejected.length > 0) {
          changelogRows.push({
            raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
            change_type: "composition_changed", field: "allergens_forkastet",
            old_value: null, new_value: diff.rejected,
            severity: "medium", created_by: userId,
          });
        }
      }
    }

    // ---------------- Ingrediensdeklarasjon ----------------
    if (accepts.has("ingredient_declaration") && ext.ingredient_declaration) {
      const { data: oldNut, error: readErr } = await service.from("raw_material_nutrition")
        .select("ingredient_declaration").eq("raw_material_id", rm.id).maybeSingle();
      if (readErr) {
        failures.push(`ingrediensdeklarasjon (lesing): ${readErr.message}`);
      } else if (oldNut?.ingredient_declaration !== ext.ingredient_declaration) {
        const { error: wErr } = await service.from("raw_material_nutrition").upsert({
          raw_material_id: rm.id, ingredient_declaration: ext.ingredient_declaration,
        }, { onConflict: "raw_material_id" });
        if (wErr) failures.push(`ingrediensdeklarasjon: ${wErr.message}`);
        else changelogRows.push({
          raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
          change_type: "composition_changed", field: "ingredient_declaration",
          old_value: oldNut?.ingredient_declaration ?? null, new_value: ext.ingredient_declaration,
          severity: "medium", created_by: userId,
        });
      }
    }

    // ---------------- Sammensatte komponenter ----------------
    if (accepts.has("composite") && Array.isArray(ext.composite_components) && ext.composite_components.length > 0) {
      // Komponenter som er koblet til en egen råvare er satt opp av et menneske
      // og skal overleve et tekstforslag fra AI. Bare tidligere AI-forslag uten
      // kobling erstattes.
      const { data: existingComps, error: compReadErr } = await service
        .from("raw_material_components")
        .select("id, component_raw_material_id, primary_ingredient_name, sort_order")
        .eq("parent_raw_material_id", rm.id);
      if (compReadErr) {
        failures.push(`komponenter (lesing): ${compReadErr.message}`);
      } else {
        const linked = (existingComps ?? []).filter((c) => !!c.component_raw_material_id);
        const replaceableIds = (existingComps ?? []).filter((c) => !c.component_raw_material_id).map((c) => c.id);
        let compsOk = true;
        if (replaceableIds.length > 0) {
          const { error: delErr } = await service.from("raw_material_components").delete().in("id", replaceableIds);
          if (delErr) { failures.push(`komponenter (opprydding): ${delErr.message}`); compsOk = false; }
        }
        const linkedNames = new Set(
          linked.map((c) => String(c.primary_ingredient_name ?? "").trim().toLowerCase()).filter(Boolean),
        );
        const offset = linked.length;
        // deno-lint-ignore no-explicit-any
        const rows = (ext.composite_components as any[])
          .filter((c) => !linkedNames.has(String(c?.name ?? "").trim().toLowerCase()))
          .map((c, i) => ({
            parent_raw_material_id: rm.id,
            primary_ingredient_name: c.name,
            percentage: Math.max(0.01, Math.min(100, Number(c.percentage) || 1)),
            is_explicit_percentage: c.percentage != null,
            sort_order: offset + i,
            suggested_by_ai: true,
            needs_review: true,
          }));
        if (compsOk && rows.length > 0) {
          const { error: insErr } = await service.from("raw_material_components").insert(rows);
          if (insErr) { failures.push(`komponenter: ${insErr.message}`); compsOk = false; }
        }
        // is_composite settes IKKE når komponentene bare er tekst uten kobling til egne
        // råvarer — da ville deklarasjonen mistet råvarens egen næring og allergener.
        if (compsOk && rows.length > 0 && !ext.ingredient_declaration) {
          const declaration = rows
            .map((r) => (r.is_explicit_percentage ? `${r.primary_ingredient_name} (${r.percentage} %)` : r.primary_ingredient_name))
            .join(", ");
          const { error: dErr } = await service.from("raw_material_nutrition").upsert({
            raw_material_id: rm.id, ingredient_declaration: declaration,
          }, { onConflict: "raw_material_id" });
          if (dErr) failures.push(`deklarasjon fra komponenter: ${dErr.message}`);
        }
        if (compsOk && rows.length > 0) {
          changelogRows.push({
            raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
            change_type: "composition_changed", field: "components",
            old_value: null, new_value: rows.map((r) => r.primary_ingredient_name),
            severity: "medium", created_by: userId,
          });
        }
      }
    }

    // ---------------- Brødskala ----------------
    if (accepts.has("grain") && ext.grain_classification_hint) {
      if (rm.grain_classification !== ext.grain_classification_hint) {
        const { error: gErr } = await service.from("raw_materials")
          .update({ grain_classification: ext.grain_classification_hint }).eq("id", rm.id);
        if (gErr) failures.push(`brødskala: ${gErr.message}`);
        else changelogRows.push({
          raw_material_id: rm.id, legal_entity_id: rm.legal_entity_id, datasheet_id: ds.id,
          change_type: "grain_changed", field: "grain_classification",
          old_value: rm.grain_classification, new_value: ext.grain_classification_hint,
          severity: "low", created_by: userId,
        });
      }
    }

    // ---------------- Pakning: forslag, ikke skriving ----------------
    // Rå skriving av package_size ville hoppet over kostprisberegningen i
    // set_raw_material_package. Vi returnerer forslaget, og brukeren fullfører
    // i pakningsdialogen.
    if (ext.package_size_value != null) {
      const unchanged = Number(rm.package_size) === Number(ext.package_size_value) && rm.package_unit === ext.package_size_unit;
      if (!unchanged) {
        followUps.package_suggestion = {
          current: { size: rm.package_size ?? null, unit: rm.package_unit ?? null },
          suggested: { size: ext.package_size_value, unit: ext.package_size_unit ?? null },
          note: "Bekreft i pakningsdialogen — der regnes kostprisen om.",
        };
      }
    }

    // ---------------- Berørte oppskrifter/produkter ----------------
    const { data: affectedRecipes, error: recErr } = await service.from("recipe_lines")
      .select("recipe_id").eq("raw_material_id", rm.id);
    if (recErr) failures.push(`berørte oppskrifter: ${recErr.message}`);
    const recipeIds = Array.from(new Set((affectedRecipes ?? []).map((r) => r.recipe_id)));
    let affectedProductIds: string[] = [];
    if (recipeIds.length > 0) {
      const { data: links, error: linkErr } = await service.from("product_recipe_links")
        .select("product_id").in("recipe_id", recipeIds);
      if (linkErr) failures.push(`berørte produkter: ${linkErr.message}`);
      affectedProductIds = Array.from(new Set((links ?? []).map((l) => l.product_id)));
      if (affectedProductIds.length > 0) {
        const { error: prodErr } = await service.from("products").update({
          declaration_needs_review: true,
          declaration_review_reason: `Råvare "${rm.name}" oppdatert fra datablad`,
        }).in("id", affectedProductIds);
        if (prodErr) failures.push(`flagging av produkter: ${prodErr.message}`);
      }
    }

    // ---------------- Changelog ----------------
    changelogRows.forEach((r) => { r.affected_recipes_count = recipeIds.length; });
    let changesLogged = 0;
    if (changelogRows.length > 0) {
      const { error: clErr } = await service.from("raw_material_changelog").insert(changelogRows);
      if (clErr) failures.push(`changelog: ${clErr.message}`);
      else changesLogged = changelogRows.length;
    }

    // ---------------- Status på databladet ----------------
    // Bare et datablad der ALT gikk gjennom kan kalles anvendt.
    let applied = false;
    if (failures.length === 0) {
      const { error: unsetErr } = await service.from("raw_material_datasheets").update({ is_current: false })
        .eq("raw_material_id", rm.id).eq("is_current", true);
      if (unsetErr) failures.push(`datablad (nullstille gjeldende): ${unsetErr.message}`);
      const { error: statusErr } = await service.from("raw_material_datasheets").update({
        status: "applied", is_current: true, raw_material_id: rm.id,
      }).eq("id", ds.id);
      if (statusErr) failures.push(`datablad (status): ${statusErr.message}`);
      applied = failures.length === 0;
    }

    return json({
      applied,
      failures,
      changes_logged: changesLogged,
      affected_recipes: recipeIds.length,
      affected_products: affectedProductIds.length,
      follow_ups: followUps,
    }, failures.length > 0 ? 207 : 200);
  } catch (e) {
    console.error("apply-datasheet-update", e);
    return json({ error: "internal_error" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
