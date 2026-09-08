/**
 * Editortilstanden for én oppskrift, samlet i én reducer.
 *
 * Før lå hode, deler, linjer, steg og «ulagret»-flagget i hver sin `useState` i
 * `RecipeDetail.tsx`, med `setDirty(true)` spredt utover. Det gjorde det umulig
 * å garantere at prosentlinjer alltid følger melvekten. Nå går alle endringer
 * gjennom ett sted, og re-avledningen av prosentlinjer skjer som en del av hver
 * eneste handling som rører linjene.
 */

import { useCallback, useMemo, useReducer } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { Database } from "@/integrations/supabase/types";
import type { EditorLine, EditorPart } from "@/varer/components/recipes/RecipePartCard";
import type { EditorStep } from "@/varer/components/recipes/RecipeStepsEditor";
import { computeTotals } from "@/varer/lib/bakers";
import {
  applyEntryMode,
  rederivePercentLines,
  type PartEntryMode,
  type PartEntryModes,
} from "@/varer/lib/percentFirst";

/** Redigerbare felter på oppskriftshodet — speiler `recipes`-kolonnene vi eier her. */
export type HeaderState = {
  name: string;
  category: string;
  /** '' = ingen avdeling; ellers 'bakeri' | 'konditori'. */
  department: string;
  status: string;
  description: string;
  dough_piece_grams: number | string;
  dough_waste_pct: number | string;
  finished_weight_grams: number | string;
  measured_per_kg: boolean;
  units_per_batch: number | string;
  target_dough_temp_celsius: number | null;
  friction_factor_celsius: number | null;
  mixing_speed1_minutes: number | string;
  mixing_speed2_minutes: number | string;
  autolyse_minutes: number | string;
  notes: string;
  decor_notes: string;
};

type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];
type PartRow = Database["public"]["Tables"]["recipe_parts"]["Row"];
type LineRow = Database["public"]["Tables"]["recipe_lines"]["Row"];
type StepRow = Database["public"]["Tables"]["recipe_steps"]["Row"];

/** Oppskriften slik detaljspørringen leverer den, med barnetabellene nøstet inn. */
export type RecipeDetailRow = RecipeRow & {
  recipe_parts: PartRow[] | null;
  recipe_lines: LineRow[] | null;
  recipe_steps: StepRow[] | null;
};

export interface RecipeEditorState {
  header: Partial<HeaderState>;
  parts: EditorPart[];
  lines: EditorLine[];
  steps: EditorStep[];
  imageUrl: string | null;
  /** Registreringsmodus per del — ren editorinnstilling, lagres ikke. */
  entryModes: PartEntryModes;
  dirty: boolean;
}

export const emptyEditorState: RecipeEditorState = {
  header: {},
  parts: [],
  lines: [],
  steps: [],
  imageUrl: null,
  entryModes: {},
  dirty: false,
};

type Action =
  | { type: "hydrate"; state: RecipeEditorState }
  | { type: "restore"; state: RecipeEditorState }
  | { type: "patchHeader"; patch: Partial<HeaderState> }
  | { type: "setImage"; url: string | null }
  | { type: "addPart"; partType: string }
  | { type: "updatePart"; partId: string; patch: Partial<EditorPart> }
  | { type: "removePart"; partId: string }
  | { type: "duplicatePart"; partId: string }
  | { type: "movePart"; partId: string; dir: -1 | 1 }
  | { type: "setEntryMode"; partId: string; mode: PartEntryMode }
  | { type: "addLine"; partId: string; lineId: string }
  | { type: "updateLine"; lineId: string; patch: Partial<EditorLine> }
  | { type: "removeLine"; lineId: string }
  | { type: "reorderLines"; partId: string; activeId: string; overId: string }
  | { type: "setSteps"; steps: EditorStep[] }
  | { type: "markSaved" };

/** Melvekten linjene skal måles mot akkurat nå. */
function flourOf(lines: EditorLine[]): number {
  return computeTotals(lines).totalFlourG;
}

/**
 * Etter hver linjeendring får %-linjene mengden regnet om på nytt.
 * Det er dette som gjør at bakerprosentene aldri henger etter melmengden.
 */
function withRederived(lines: EditorLine[]): EditorLine[] {
  return rederivePercentLines(lines, flourOf(lines));
}

export function recipeEditorReducer(state: RecipeEditorState, action: Action): RecipeEditorState {
  switch (action.type) {
    case "hydrate":
      return { ...action.state, dirty: false };

    case "restore":
      // Et gjenopprettet utkast er per definisjon ulagret arbeid.
      return { ...action.state, dirty: true };

    case "patchHeader":
      return { ...state, header: { ...state.header, ...action.patch }, dirty: true };

    case "setImage":
      return { ...state, imageUrl: action.url };

    case "addPart": {
      const id = `new-part-${Date.now()}-${Math.random()}`;
      const part: EditorPart = {
        id,
        _new: true,
        name: action.partType === "preferment" ? "Fordeig" : "Hoveddeig",
        sort_order: state.parts.length,
        instructions: null,
        prep_time_minutes: null,
        rest_time_minutes: null,
        part_type: action.partType,
        preferment_kind: action.partType === "preferment" ? "fordeig" : null,
        target_temp_celsius: null,
        ripe_time_hours: null,
      };
      return { ...state, parts: [...state.parts, part], dirty: true };
    }

    case "updatePart":
      return {
        ...state,
        parts: state.parts.map((p) => (p.id === action.partId ? { ...p, ...action.patch } : p)),
        dirty: true,
      };

    case "removePart": {
      const lines = withRederived(state.lines.filter((l) => l.recipe_part_id !== action.partId));
      const entryModes = { ...state.entryModes };
      delete entryModes[action.partId];
      return {
        ...state,
        parts: state.parts.filter((p) => p.id !== action.partId).map((p, i) => ({ ...p, sort_order: i })),
        lines,
        entryModes,
        dirty: true,
      };
    }

    case "duplicatePart": {
      const idx = state.parts.findIndex((p) => p.id === action.partId);
      const source = state.parts[idx];
      if (!source) return state;
      const newId = `new-part-${Date.now()}-${Math.random()}`;
      const dupLines = state.lines
        .filter((l) => l.recipe_part_id === action.partId)
        .map((l) => ({
          ...l,
          id: `new-line-${Date.now()}-${Math.random()}`,
          _new: true,
          recipe_part_id: newId,
        }));
      const parts = [
        ...state.parts.slice(0, idx + 1),
        { ...source, id: newId, _new: true, name: `${source.name} (kopi)`, sort_order: idx + 1 },
        ...state.parts.slice(idx + 1),
      ].map((p, i) => ({ ...p, sort_order: i }));
      return {
        ...state,
        parts,
        lines: withRederived([...state.lines, ...dupLines]),
        entryModes: { ...state.entryModes, [newId]: state.entryModes[action.partId] ?? "grams" },
        dirty: true,
      };
    }

    case "movePart": {
      const idx = state.parts.findIndex((p) => p.id === action.partId);
      const next = idx + action.dir;
      if (idx < 0 || next < 0 || next >= state.parts.length) return state;
      return {
        ...state,
        parts: arrayMove(state.parts, idx, next).map((p, i) => ({ ...p, sort_order: i })),
        dirty: true,
      };
    }

    case "setEntryMode": {
      const lines = applyEntryMode(state.lines, action.partId, action.mode, flourOf(state.lines));
      return {
        ...state,
        entryModes: { ...state.entryModes, [action.partId]: action.mode },
        lines: withRederived(lines),
        // Bytte av registreringsmodus kan endre lagret prosent på linjene, så
        // det er en reell endring — ikke bare en visningsinnstilling.
        dirty: lines !== state.lines ? true : state.dirty,
      };
    }

    case "addLine": {
      const count = state.lines.filter((l) => l.recipe_part_id === action.partId).length;
      const line = {
        id: action.lineId,
        _new: true,
        recipe_part_id: action.partId,
        raw_material_id: null,
        sub_product_id: null,
        ingredient_name: null,
        quantity: "",
        unit: "g",
        waste_percent: 0,
        sort_order: count,
        entry_mode: state.entryModes[action.partId] === "percent" ? "percent" : "grams",
        bakers_percent: null,
        is_flour_override: null,
        water_content_pct_override: null,
        include_in_declaration: true,
        is_quid_relevant: false,
        custom_declaration_text: null,
      } as EditorLine;
      return { ...state, lines: [...state.lines, line], dirty: true };
    }

    case "updateLine": {
      const lines = state.lines.map((l) => (l.id === action.lineId ? { ...l, ...action.patch } : l));
      return { ...state, lines: withRederived(lines), dirty: true };
    }

    case "removeLine":
      return { ...state, lines: withRederived(state.lines.filter((l) => l.id !== action.lineId)), dirty: true };

    case "reorderLines": {
      const partLines = state.lines.filter((l) => l.recipe_part_id === action.partId);
      const others = state.lines.filter((l) => l.recipe_part_id !== action.partId);
      const oldIdx = partLines.findIndex((l) => l.id === action.activeId);
      const newIdx = partLines.findIndex((l) => l.id === action.overId);
      if (oldIdx < 0 || newIdx < 0) return state;
      return {
        ...state,
        lines: [...others, ...arrayMove(partLines, oldIdx, newIdx).map((l, i) => ({ ...l, sort_order: i }))],
        dirty: true,
      };
    }

    case "setSteps":
      return { ...state, steps: action.steps, dirty: true };

    case "markSaved":
      return { ...state, dirty: false };

    default:
      return state;
  }
}

/** Bygger editortilstanden fra en rad hentet fra basen. */
export function stateFromRecipe(recipe: RecipeDetailRow): RecipeEditorState {
  const header: Partial<HeaderState> = {
    name: recipe.name ?? "",
    category: recipe.category ?? "",
    department: recipe.department ?? "",
    status: recipe.status ?? "draft",
    description: recipe.description ?? "",
    dough_piece_grams: recipe.dough_piece_grams ?? "",
    dough_waste_pct: recipe.dough_waste_pct ?? "",
    finished_weight_grams: recipe.finished_weight_grams ?? "",
    measured_per_kg: recipe.measured_per_kg ?? false,
    units_per_batch: recipe.units_per_batch ?? "",
    target_dough_temp_celsius: recipe.target_dough_temp_celsius,
    friction_factor_celsius: recipe.friction_factor_celsius,
    mixing_speed1_minutes: recipe.mixing_speed1_minutes ?? "",
    mixing_speed2_minutes: recipe.mixing_speed2_minutes ?? "",
    autolyse_minutes: recipe.autolyse_minutes ?? "",
    notes: recipe.notes ?? "",
    decor_notes: recipe.decor_notes ?? "",
  };

  const bySort = <T extends { sort_order: number | null }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const parts: EditorPart[] = bySort(recipe.recipe_parts ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    sort_order: p.sort_order ?? 0,
    instructions: p.instructions,
    prep_time_minutes: p.prep_time_minutes,
    rest_time_minutes: p.rest_time_minutes,
    part_type: p.part_type ?? "dough",
    preferment_kind: p.preferment_kind ?? null,
    target_temp_celsius: p.target_temp_celsius,
    ripe_time_hours: p.ripe_time_hours,
  }));

  const lines = bySort(recipe.recipe_lines ?? []).map((l) => ({ ...l, _rm: null })) as unknown as EditorLine[];
  const steps = bySort(recipe.recipe_steps ?? []) as unknown as EditorStep[];

  // Deler der alle ikke-melinjer er registrert i prosent åpnes i prosentmodus,
  // slik at brukeren møter oppskriften slik den sist ble ført.
  const entryModes: PartEntryModes = {};
  for (const part of parts) {
    const partLines = lines.filter((l) => l.recipe_part_id === part.id);
    const candidates = partLines.filter((l) => l.entry_mode != null);
    entryModes[part.id] =
      candidates.length > 0 && candidates.every((l) => l.entry_mode === "percent") ? "percent" : "grams";
  }

  return { header, parts, lines, steps, imageUrl: recipe.image_url ?? null, entryModes, dirty: false };
}

export function useRecipeEditor() {
  const [state, dispatch] = useReducer(recipeEditorReducer, emptyEditorState);

  const actions = useMemo(
    () => ({
      hydrate: (recipe: RecipeDetailRow) => dispatch({ type: "hydrate", state: stateFromRecipe(recipe) }),
      restore: (next: RecipeEditorState) => dispatch({ type: "restore", state: next }),
      patchHeader: (patch: Partial<HeaderState>) => dispatch({ type: "patchHeader", patch }),
      setImage: (url: string | null) => dispatch({ type: "setImage", url }),
      addPart: (partType = "dough") => dispatch({ type: "addPart", partType }),
      updatePart: (partId: string, patch: Partial<EditorPart>) => dispatch({ type: "updatePart", partId, patch }),
      removePart: (partId: string) => dispatch({ type: "removePart", partId }),
      duplicatePart: (partId: string) => dispatch({ type: "duplicatePart", partId }),
      movePart: (partId: string, dir: -1 | 1) => dispatch({ type: "movePart", partId, dir }),
      setEntryMode: (partId: string, mode: PartEntryMode) => dispatch({ type: "setEntryMode", partId, mode }),
      updateLine: (lineId: string, patch: Partial<EditorLine>) => dispatch({ type: "updateLine", lineId, patch }),
      removeLine: (lineId: string) => dispatch({ type: "removeLine", lineId }),
      reorderLines: (partId: string, activeId: string, overId: string) =>
        dispatch({ type: "reorderLines", partId, activeId, overId }),
      setSteps: (steps: EditorStep[]) => dispatch({ type: "setSteps", steps }),
      markSaved: () => dispatch({ type: "markSaved" }),
    }),
    [],
  );

  /** Legger til en linje og returnerer id-en, slik at griddet kan fokusere den. */
  const addLine = useCallback((partId: string): string => {
    const lineId = `new-line-${Date.now()}-${Math.random()}`;
    dispatch({ type: "addLine", partId, lineId });
    return lineId;
  }, []);

  return { state, ...actions, addLine };
}
