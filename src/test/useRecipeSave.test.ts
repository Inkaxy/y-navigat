import { describe, it, expect } from "vitest";
import { buildSaveRecipePayload, mapSaveRecipeError, RecipeSaveConflictError } from "@/varer/hooks/useRecipeSave";
import type { EditorPart, EditorLine } from "@/varer/components/recipes/RecipePartCard";
import type { EditorStep } from "@/varer/components/recipes/RecipeStepsEditor";

const part: EditorPart = {
  id: "part-1",
  name: "Deig",
  sort_order: 0,
  instructions: null,
  prep_time_minutes: null,
  rest_time_minutes: null,
  part_type: "dough",
  preferment_kind: null,
  target_temp_celsius: null,
  ripe_time_hours: null,
};

const line: EditorLine = {
  id: "line-1",
  recipe_part_id: "part-1",
  raw_material_id: "rm-1",
  quantity: 500,
  unit: "g",
  waste_percent: 0,
  sort_order: 0,
};

const step: EditorStep = {
  id: "step-1",
  sort_order: 0,
  step_type: "mix",
  title: "Elt",
  instruction: null,
  duration_minutes: 10,
  temp_celsius: null,
  humidity_pct: null,
};

describe("buildSaveRecipePayload", () => {
  it("sender id på alle barn, recipe_part_id på linjene, og updated_at uendret", () => {
    const payload = buildSaveRecipePayload({
      recipeId: "recipe-1",
      updatedAt: "2024-01-01T00:00:00Z",
      displayName: "Test",
      header: { name: "Test", status: "draft" },
      parts: [part],
      lines: [line],
      steps: [step],
      changeSummary: "Justerte hydrering",
    });

    expect(payload.id).toBe("recipe-1");
    expect(payload.updated_at).toBe("2024-01-01T00:00:00Z");
    expect(payload.change_summary).toBe("Justerte hydrering");
    expect(payload.parts[0].id).toBe("part-1");
    expect(payload.lines[0].id).toBe("line-1");
    expect(payload.lines[0].recipe_part_id).toBe("part-1");
    expect(payload.steps[0].id).toBe("step-1");
  });

  it("forkaster tomme linjer stille", () => {
    const emptyLine: EditorLine = { ...line, id: "line-2", raw_material_id: null, ingredient_name: null, quantity: "" };
    const payload = buildSaveRecipePayload({
      recipeId: "recipe-1",
      updatedAt: null,
      displayName: "Test",
      header: { name: "Test" },
      parts: [part],
      lines: [line, emptyLine],
      steps: [],
    });
    expect(payload.lines).toHaveLength(1);
  });

  it("sender temperaturer, keyhole_group og is_template fra hodet", () => {
    const payload = buildSaveRecipePayload({
      recipeId: "recipe-1",
      updatedAt: null,
      displayName: "Test",
      header: {
        name: "Test",
        room_temp_celsius: 22,
        flour_temp_celsius: 18,
        preferment_temp_celsius: 20,
        keyhole_group: "brod",
        is_template: true,
      },
      parts: [part],
      lines: [line],
      steps: [],
    });
    expect(payload.room_temp_celsius).toBe(22);
    expect(payload.flour_temp_celsius).toBe(18);
    expect(payload.preferment_temp_celsius).toBe(20);
    expect(payload.keyhole_group).toBe("brod");
    expect(payload.is_template).toBe(true);
  });
});

describe("mapSaveRecipeError", () => {
  it("mapper P0409 til konfliktfeil", () => {
    const err = mapSaveRecipeError({ code: "P0409", message: "conflict" });
    expect(err).toBeInstanceOf(RecipeSaveConflictError);
  });

  it("mapper 42501 til tilgangsmelding", () => {
    const err = mapSaveRecipeError({ code: "42501" });
    expect(err.message).toMatch(/tilgang/i);
  });
});
