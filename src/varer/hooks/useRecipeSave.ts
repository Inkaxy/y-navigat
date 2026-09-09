import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  room_temp_celsius?: number | string | null;
  flour_temp_celsius?: number | string | null;
  preferment_temp_celsius?: number | string | null;
  keyhole_group?: string | null;
  is_template?: boolean;
}

export interface RecipeSaveInput {
  recipeId: string;
  /** `recipes.updated_at` slik den ble hentet — brukes til optimistisk låsing i `save_recipe`. */
  updatedAt: string | null;
  displayName: string;
  header: RecipeHeaderInput;
  parts: EditorPart[];
  lines: EditorLine[];
  steps: EditorStep[];
  /** Kort forklaring til versjonshistorikken. */
  changeSummary?: string | null;
}

export interface RecipeSaveResult {
  version: number;
  updatedAt: string;
}

/** Hvilket steg som feilet — gir presise feilmeldinger i stedet for «Kunne ikke lagre». */
export type SavePhase = "oppskrift" | "deler" | "ingredienser" | "steg";

export class RecipeSaveError extends Error {
  constructor(readonly phase: SavePhase, readonly detail: string) {
    super(detail);
    this.name = "RecipeSaveError";
  }
}

/** Kastes når `save_recipe` avviser lagringen fordi noen andre har lagret i mellomtiden (Postgres P0409). */
export class RecipeSaveConflictError extends Error {
  constructor() {
    super("Oppskriften er endret av noen andre – last inn på nytt.");
    this.name = "RecipeSaveConflictError";
  }
}

function num(v: number | string | null | undefined): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Kontrollerer HELE oppskriften før noe sendes til `save_recipe`.
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

/** JSON-formen `save_recipe(p_recipe jsonb)` forventer. Rene datastrukturer — ingen sideeffekter her. */
export interface SaveRecipePayload {
  id: string;
  updated_at: string | null;
  name: string | null;
  category: string | null;
  department: string | null;
  status: string | undefined;
  description: string | null;
  notes: string | null;
  decor_notes: string | null;
  dough_piece_grams: number | null;
  dough_waste_pct: number | null;
  finished_weight_grams: number | null;
  measured_per_kg: boolean;
  units_per_batch: number | null;
  target_dough_temp_celsius: number | null;
  friction_factor_celsius: number | null;
  mixing_speed1_minutes: number | null;
  mixing_speed2_minutes: number | null;
  autolyse_minutes: number | null;
  room_temp_celsius: number | null;
  flour_temp_celsius: number | null;
  preferment_temp_celsius: number | null;
  keyhole_group: string | null;
  is_template: boolean;
  change_summary: string | null;
  parts: {
    id: string;
    name: string;
    sort_order: number;
    instructions: string | null;
    prep_time_minutes: number | null;
    rest_time_minutes: number | null;
    part_type: string;
    preferment_kind: string | null;
    target_temp_celsius: number | null;
    ripe_time_hours: number | null;
    _new?: boolean;
  }[];
  lines: {
    id: string;
    recipe_part_id: string;
    raw_material_id: string | null;
    sub_product_id: string | null;
    ingredient_name: string | null;
    quantity: number;
    unit: string;
    waste_percent: number;
    sort_order: number;
    notes: string | null;
    entry_mode: string;
    bakers_percent: number | null;
    is_flour_override: boolean | null;
    water_content_pct_override: number | null;
    include_in_declaration: boolean;
    is_quid_relevant: boolean;
    custom_declaration_text: string | null;
    _new?: boolean;
  }[];
  steps: {
    id: string;
    sort_order: number;
    step_type: string;
    title: string | null;
    instruction: string | null;
    duration_minutes: number | null;
    temp_celsius: number | null;
    humidity_pct: number | null;
    _new?: boolean;
  }[];
}

/** Bygger payloaden til `save_recipe`. Tomme linjer forkastes stille — samme regel som valideringen. */
export function buildSaveRecipePayload(input: RecipeSaveInput): SaveRecipePayload {
  const h = input.header;
  const lines = input.lines
    .map((l) => {
      const qty = Number(l.quantity) || 0;
      if (qty <= 0 && !l.raw_material_id && !l.sub_product_id && !l.ingredient_name) return null;
      return {
        id: l.id,
        recipe_part_id: l.recipe_part_id,
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
        ...(l._new ? { _new: true as const } : {}),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const parts = input.parts.map((p) => ({
    id: p.id,
    name: p.name,
    sort_order: p.sort_order,
    instructions: p.instructions,
    prep_time_minutes: p.prep_time_minutes,
    rest_time_minutes: p.rest_time_minutes,
    part_type: p.part_type,
    preferment_kind: p.part_type === "preferment" ? p.preferment_kind : null,
    target_temp_celsius: p.target_temp_celsius,
    ripe_time_hours: p.ripe_time_hours,
    ...(p._new ? { _new: true as const } : {}),
  }));

  const steps = input.steps.map((s) => ({
    id: s.id,
    sort_order: s.sort_order,
    step_type: s.step_type,
    title: s.title,
    instruction: s.instruction,
    duration_minutes: s.duration_minutes,
    temp_celsius: s.temp_celsius,
    humidity_pct: s.humidity_pct,
    ...(s._new ? { _new: true as const } : {}),
  }));

  return {
    id: input.recipeId,
    updated_at: input.updatedAt,
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
    room_temp_celsius: num(h.room_temp_celsius),
    flour_temp_celsius: num(h.flour_temp_celsius),
    preferment_temp_celsius: num(h.preferment_temp_celsius),
    keyhole_group: h.keyhole_group || null,
    is_template: !!h.is_template,
    change_summary: input.changeSummary || null,
    parts,
    lines,
    steps,
  };
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

/** Oversetter Postgres-feilkoder fra `save_recipe` til meldinger brukeren forstår. */
export function mapSaveRecipeError(error: PostgrestLikeError): Error {
  switch (error.code) {
    case "P0409":
      return new RecipeSaveConflictError();
    case "22023":
      return new RecipeSaveError("oppskrift", error.message ?? "Ugyldige verdier i oppskriften.");
    case "42501":
      return new RecipeSaveError("oppskrift", "Du har ikke tilgang til å lagre denne oppskriften.");
    case "23514":
      return new RecipeSaveError("oppskrift", "Oppskriften bryter en regel i databasen (sjekk verdiene).");
    default:
      return new RecipeSaveError("oppskrift", error.message ?? "Ukjent feil ved lagring.");
  }
}

/**
 * Lagrer hele oppskriften i ett `save_recipe`-kall. Databasen validerer, skriver
 * hodet, delene, linjene og stegene i én transaksjon, og teller opp versjonen —
 * det finnes ingen stille delvis lagring lenger.
 */
export function useRecipeSave() {
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (input: RecipeSaveInput): Promise<RecipeSaveResult> => {
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
      const payload = buildSaveRecipePayload(input);
      const { data, error } = await supabase.rpc("save_recipe", { p_recipe: payload as never });
      if (error) throw mapSaveRecipeError(error);
      const result = data as unknown as { version?: number; updated_at?: string } | null;
      if (!result || typeof result.version !== "number" || !result.updated_at) {
        throw new RecipeSaveError("oppskrift", "Fikk ikke svar fra lagringen.");
      }
      return { version: result.version, updatedAt: result.updated_at };
    } finally {
      setSaving(false);
    }
  }, []);

  return { save, saving };
}
