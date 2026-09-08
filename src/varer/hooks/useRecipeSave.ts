import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/varer/lib/audit";
import { normalizeRecipeUnit } from "@/varer/lib/units-recipe";
import type { EditorLine, EditorPart } from "@/varer/components/recipes/RecipePartCard";
import type { EditorStep } from "@/varer/components/recipes/RecipeStepsEditor";

/** Feltene på oppskriftshodet som lagres herfra. */
export interface RecipeHeaderInput {
  name?: string;
  category?: string;
  department?: string;
  status?: string;
  description?: string;
  notes?: string;
  decor_notes?: string;
  dough_piece_grams?: number | string;
  dough_waste_pct?: number | string;
  finished_weight_grams?: number | string;
  measured_per_kg?: boolean;
  units_per_batch?: number | string;
  target_dough_temp_celsius?: number | null;
  friction_factor_celsius?: number | null;
  mixing_speed1_minutes?: number | string;
  mixing_speed2_minutes?: number | string;
  autolyse_minutes?: number | string;
}

export interface RecipeSaveInput {
  recipeId: string;
  displayName: string;
  /** Delene som lå i databasen før redigering — brukes til å finne slettede. */
  originalPartIds: string[];
  header: RecipeHeaderInput;
  parts: EditorPart[];
  lines: EditorLine[];
  steps: EditorStep[];
}

/** Hvilket steg som feilet — gir presise feilmeldinger i stedet for «Kunne ikke lagre». */
export type SavePhase = "oppskrift" | "deler" | "ingredienser" | "steg";

const PHASE_LABEL: Record<SavePhase, string> = {
  oppskrift: "oppskriftsinformasjonen",
  deler: "delene (deig og fordeig)",
  ingredienser: "ingredienslinjene",
  steg: "produksjonsstegene",
};

export class RecipeSaveError extends Error {
  constructor(readonly phase: SavePhase, readonly detail: string) {
    super(`Kunne ikke lagre ${PHASE_LABEL[phase]}: ${detail}`);
    this.name = "RecipeSaveError";
  }
}

function num(v: number | string | null | undefined): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Kontrollerer HELE oppskriften før noe skrives.
 * Én halvferdig lagring er verre enn en avvist lagring, så alt valideres samlet
 * og brukeren får alle feilene på én gang.
 */
export function validateRecipeSave(input: RecipeSaveInput): string[] {
  const errors: string[] = [];
  if (!(input.header.name ?? "").trim()) errors.push("Oppskriften mangler navn.");

  const partIds = new Set(input.parts.map((p) => p.id));
  input.parts.forEach((p, i) => {
    if (!p.name?.trim()) errors.push(`Del ${i + 1} mangler navn.`);
  });

  input.lines.forEach((l) => {
    const label = l._rm?.name ?? l.ingredient_name ?? "En ingredienslinje";
    const qty = Number(l.quantity);
    const isEmpty =
      !l.raw_material_id && !l.sub_product_id && !(l.ingredient_name ?? "").trim() && !(qty > 0);
    if (isEmpty) return; // tomme linjer forkastes stille ved lagring
    if (!partIds.has(l.recipe_part_id)) {
      errors.push(`${label} hører til en del som er slettet.`);
      return;
    }
    if (!l.raw_material_id && !l.sub_product_id && !(l.ingredient_name ?? "").trim()) {
      errors.push(`${label} mangler råvare eller navn.`);
    }
    if (!Number.isFinite(qty) || qty < 0) {
      errors.push(`${label} har en ugyldig mengde.`);
    }
    if (!normalizeRecipeUnit(l.unit)) {
      errors.push(`${label} har ukjent enhet «${l.unit ?? ""}».`);
    }
    const waste = Number(l.waste_percent);
    if (l.waste_percent !== "" && l.waste_percent != null && (!Number.isFinite(waste) || waste < 0)) {
      errors.push(`${label} har et ugyldig svinn.`);
    }
  });

  const numericHeaderFields: [keyof RecipeHeaderInput, string][] = [
    ["dough_piece_grams", "Emnevekt"],
    ["dough_waste_pct", "Deigsvinn"],
    ["finished_weight_grams", "Ferdigvekt"],
    ["units_per_batch", "Emner per batch"],
    ["mixing_speed1_minutes", "Elting trinn 1"],
    ["mixing_speed2_minutes", "Elting trinn 2"],
    ["autolyse_minutes", "Autolyse"],
  ];
  for (const [key, label] of numericHeaderFields) {
    const raw = input.header[key];
    if (raw === "" || raw == null) continue;
    if (!Number.isFinite(Number(raw)) || Number(raw) < 0) errors.push(`${label} er ikke et gyldig tall.`);
  }

  return errors;
}

function buildLineRows(input: RecipeSaveInput, partIdMap: Record<string, string>) {
  return input.lines
    .map((l) => {
      const qty = Number(l.quantity) || 0;
      if (qty <= 0 && !l.raw_material_id && !l.sub_product_id && !l.ingredient_name) return null;
      return {
        recipe_id: input.recipeId,
        recipe_part_id: partIdMap[l.recipe_part_id] ?? l.recipe_part_id,
        raw_material_id: l.raw_material_id,
        sub_product_id: l.sub_product_id ?? null,
        ingredient_name: l.raw_material_id ? null : l.ingredient_name || null,
        quantity: qty,
        unit: l.unit,
        waste_percent: Number(l.waste_percent) || 0,
        sort_order: l.sort_order,
        notes: l.notes ?? null,
        entry_mode: l.entry_mode ?? "grams",
        bakers_percent: num(l.bakers_percent as number | string | null),
        is_flour_override: l.is_flour_override ?? null,
        water_content_pct_override: num(l.water_content_pct_override as number | string | null),
        include_in_declaration: l.include_in_declaration !== false,
        is_quid_relevant: !!l.is_quid_relevant,
        custom_declaration_text: l.custom_declaration_text || null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/**
 * Lagrer hele oppskriften. Alt valideres først, deretter skrives hodet, delene,
 * linjene og stegene. Feiler et steg, stopper vi der og forteller nøyaktig hva
 * som ikke gikk gjennom — ingen stille delvis lagring.
 */
export function useRecipeSave() {
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (input: RecipeSaveInput): Promise<void> => {
    const problems = validateRecipeSave(input);
    if (problems.length > 0) {
      throw new Error(
        problems.length === 1
          ? problems[0]
          : `Oppskriften kan ikke lagres:\n• ${problems.slice(0, 5).join("\n• ")}${problems.length > 5 ? `\n• +${problems.length - 5} til` : ""}`,
      );
    }

    setSaving(true);
    try {
      const h = input.header;
      const { error: e1 } = await supabase
        .from("recipes")
        .update({
          name: h.name || null,
          category: h.category || null,
          department: h.department || null,
          status: h.status,
          description: h.description || null,
          notes: h.notes || null,
          decor_notes: h.decor_notes || null,
          dough_piece_grams: num(h.dough_piece_grams),
          dough_waste_pct: num(h.dough_waste_pct),
          finished_weight_grams: num(h.finished_weight_grams),
          measured_per_kg: !!h.measured_per_kg,
          units_per_batch: num(h.units_per_batch),
          target_dough_temp_celsius: h.target_dough_temp_celsius ?? null,
          friction_factor_celsius: h.friction_factor_celsius ?? null,
          mixing_speed1_minutes: num(h.mixing_speed1_minutes),
          mixing_speed2_minutes: num(h.mixing_speed2_minutes),
          autolyse_minutes: num(h.autolyse_minutes),
        } as never)
        .eq("id", input.recipeId);
      if (e1) throw new RecipeSaveError("oppskrift", e1.message);

      const keptIds = input.parts.filter((p) => !p._new).map((p) => p.id);
      const toDelete = input.originalPartIds.filter((pid) => !keptIds.includes(pid));
      if (toDelete.length) {
        const { error } = await supabase.from("recipe_parts").delete().in("id", toDelete);
        if (error) throw new RecipeSaveError("deler", error.message);
      }

      const partIdMap: Record<string, string> = {};
      for (const p of input.parts) {
        const payload = {
          name: p.name,
          sort_order: p.sort_order,
          instructions: p.instructions,
          prep_time_minutes: p.prep_time_minutes,
          rest_time_minutes: p.rest_time_minutes,
          part_type: p.part_type,
          preferment_kind: p.part_type === "preferment" ? p.preferment_kind : null,
          target_temp_celsius: p.target_temp_celsius,
          ripe_time_hours: p.ripe_time_hours,
        };
        if (p._new) {
          const { data, error } = await supabase
            .from("recipe_parts")
            .insert({ recipe_id: input.recipeId, ...payload } as never)
            .select("id")
            .single();
          if (error) throw new RecipeSaveError("deler", error.message);
          partIdMap[p.id] = data.id;
        } else {
          const { error } = await supabase.from("recipe_parts").update(payload as never).eq("id", p.id);
          if (error) throw new RecipeSaveError("deler", error.message);
        }
      }

      const { error: e2 } = await supabase.rpc("replace_child_rows", {
        p_table: "recipe_lines",
        p_parent_column: "recipe_id",
        p_parent_id: input.recipeId,
        p_rows: buildLineRows(input, partIdMap),
      } as never);
      if (e2) throw new RecipeSaveError("ingredienser", e2.message);

      const stepRows = input.steps.map((s, i) => ({
        recipe_id: input.recipeId,
        sort_order: i,
        step_type: s.step_type,
        title: s.title || null,
        instruction: s.instruction || null,
        duration_minutes: s.duration_minutes,
        temp_celsius: s.temp_celsius,
        humidity_pct: s.humidity_pct,
      }));
      const { error: e3 } = await supabase.rpc("replace_child_rows", {
        p_table: "recipe_steps",
        p_parent_column: "recipe_id",
        p_parent_id: input.recipeId,
        p_rows: stepRows,
      } as never);
      if (e3) throw new RecipeSaveError("steg", e3.message);

      await logAudit({
        action: "update",
        entity_type: "recipe",
        entity_id: input.recipeId,
        entity_display_reference: input.displayName,
        changes: {
          parts: input.parts.length,
          lines: input.lines.length,
          steps: input.steps.length,
        },
      });
    } finally {
      setSaving(false);
    }
  }, []);

  return { saving, save };
}
