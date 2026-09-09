/**
 * Versjonshistorikk for oppskrifter — leser `recipe_versions` og bygger
 * inndata til `save_recipe` (via `useRecipeSave`) for å gjenopprette et snapshot.
 */
import type { Json } from "@/integrations/supabase/types";
import type { EditorLine, EditorPart } from "@/varer/components/recipes/RecipePartCard";
import type { EditorStep } from "@/varer/components/recipes/RecipeStepsEditor";
import type { RecipeHeaderInput, RecipeSaveInput } from "@/varer/hooks/useRecipeSave";

export interface RecipeVersionRow {
  id: string;
  recipe_id: string;
  version: number;
  changed_at: string;
  changed_by: string | null;
  change_summary: string | null;
  diff: Json | null;
  snapshot: Json;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

/** Bygger `save_recipe`-inndata fra et lagret snapshot — samme feltnavn som `save_recipe` skrev til basen. */
export function buildRestoreInput(
  snapshot: Json,
  opts: { recipeId: string; updatedAt: string | null; version: number },
): RecipeSaveInput {
  const s = obj(snapshot);

  const header: RecipeHeaderInput = {
    name: str(s.name) ?? "",
    category: str(s.category) ?? "",
    department: str(s.department) ?? "",
    status: str(s.status) ?? "draft",
    description: str(s.description) ?? "",
    notes: str(s.notes) ?? "",
    decor_notes: str(s.decor_notes) ?? "",
    dough_piece_grams: num(s.dough_piece_grams) ?? "",
    dough_waste_pct: num(s.dough_waste_pct) ?? "",
    finished_weight_grams: num(s.finished_weight_grams) ?? "",
    measured_per_kg: bool(s.measured_per_kg) ?? false,
    units_per_batch: num(s.units_per_batch) ?? "",
    target_dough_temp_celsius: num(s.target_dough_temp_celsius) ?? null,
    friction_factor_celsius: num(s.friction_factor_celsius) ?? null,
    mixing_speed1_minutes: num(s.mixing_speed1_minutes) ?? "",
    mixing_speed2_minutes: num(s.mixing_speed2_minutes) ?? "",
    autolyse_minutes: num(s.autolyse_minutes) ?? "",
    room_temp_celsius: num(s.room_temp_celsius) ?? "",
    flour_temp_celsius: num(s.flour_temp_celsius) ?? "",
    preferment_temp_celsius: num(s.preferment_temp_celsius) ?? "",
    keyhole_group: str(s.keyhole_group) ?? null,
    is_template: bool(s.is_template) ?? false,
  };

  const parts: EditorPart[] = arr(s.parts).map((p) => ({
    id: String(p.id ?? ""),
    name: str(p.name) ?? "",
    sort_order: num(p.sort_order) ?? 0,
    instructions: str(p.instructions) ?? null,
    prep_time_minutes: num(p.prep_time_minutes) ?? null,
    rest_time_minutes: num(p.rest_time_minutes) ?? null,
    part_type: str(p.part_type) ?? "other",
    preferment_kind: str(p.preferment_kind) ?? null,
    target_temp_celsius: num(p.target_temp_celsius) ?? null,
    ripe_time_hours: num(p.ripe_time_hours) ?? null,
  }));

  const lines: EditorLine[] = arr(s.lines).map((l) => ({
    id: String(l.id ?? ""),
    recipe_part_id: String(l.recipe_part_id ?? ""),
    raw_material_id: str(l.raw_material_id) ?? null,
    sub_product_id: str(l.sub_product_id) ?? null,
    ingredient_name: str(l.ingredient_name) ?? null,
    quantity: num(l.quantity) ?? 0,
    unit: str(l.unit) ?? "g",
    waste_percent: num(l.waste_percent) ?? 0,
    sort_order: num(l.sort_order) ?? 0,
    notes: str(l.notes) ?? null,
    entry_mode: str(l.entry_mode) ?? "grams",
    bakers_percent: num(l.bakers_percent) ?? null,
    is_flour_override: bool(l.is_flour_override) ?? null,
    water_content_pct_override: num(l.water_content_pct_override) ?? null,
    include_in_declaration: bool(l.include_in_declaration) ?? true,
    is_quid_relevant: bool(l.is_quid_relevant) ?? false,
    custom_declaration_text: str(l.custom_declaration_text) ?? null,
  }));

  const steps: EditorStep[] = arr(s.steps).map((st) => ({
    id: String(st.id ?? ""),
    sort_order: num(st.sort_order) ?? 0,
    step_type: str(st.step_type) ?? "other",
    title: str(st.title) ?? null,
    instruction: str(st.instruction) ?? null,
    duration_minutes: num(st.duration_minutes) ?? null,
    temp_celsius: num(st.temp_celsius) ?? null,
    humidity_pct: num(st.humidity_pct) ?? null,
  }));

  return {
    recipeId: opts.recipeId,
    updatedAt: opts.updatedAt,
    displayName: header.name ?? "",
    header,
    parts,
    lines,
    steps,
    changeSummary: `Gjenopprettet fra versjon ${opts.version}`,
  };
}
