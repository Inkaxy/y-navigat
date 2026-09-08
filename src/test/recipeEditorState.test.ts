import { describe, expect, it } from "vitest";
import {
  emptyEditorState,
  recipeEditorReducer,
  type RecipeEditorState,
} from "@/varer/hooks/useRecipeEditor";
import type { EditorLine, EditorPart } from "@/varer/components/recipes/RecipePartCard";

const part: EditorPart = {
  id: "p1",
  name: "Hoveddeig",
  sort_order: 0,
  instructions: null,
  prep_time_minutes: null,
  rest_time_minutes: null,
  part_type: "dough",
  preferment_kind: null,
  target_temp_celsius: null,
  ripe_time_hours: null,
};

function line(over: Partial<EditorLine> & { id: string }): EditorLine {
  return {
    recipe_part_id: "p1",
    raw_material_id: null,
    sub_product_id: null,
    ingredient_name: "Ukjent",
    quantity: 0,
    unit: "g",
    waste_percent: 0,
    sort_order: 0,
    entry_mode: "grams",
    bakers_percent: null,
    is_flour_override: null,
    water_content_pct_override: null,
    _rm: null,
    ...over,
  } as unknown as EditorLine;
}

function stateWith(lines: EditorLine[]): RecipeEditorState {
  return { ...emptyEditorState, parts: [part], lines };
}

const flour = line({ id: "l1", ingredient_name: "Hvetemel", quantity: 1000, is_flour_override: true });
const water = line({ id: "l2", ingredient_name: "Vann", quantity: 650, entry_mode: "percent", bakers_percent: 65 });

describe("recipeEditorReducer", () => {
  it("markerer ulagret ved endring og fjerner merket ved lagring", () => {
    const dirtyState = recipeEditorReducer(stateWith([flour]), {
      type: "patchHeader",
      patch: { name: "Grovbrød" },
    });
    expect(dirtyState.dirty).toBe(true);
    expect(recipeEditorReducer(dirtyState, { type: "markSaved" }).dirty).toBe(false);
  });

  it("regner om prosentlinjer når melvekten endres", () => {
    const next = recipeEditorReducer(stateWith([flour, water]), {
      type: "updateLine",
      lineId: "l1",
      patch: { quantity: 2000 },
    });
    const updatedWater = next.lines.find((l) => l.id === "l2");
    expect(Number(updatedWater?.quantity)).toBe(1300);
    expect(Number(updatedWater?.bakers_percent)).toBe(65);
  });

  it("beholder gramlinjer urørt når melvekten endres", () => {
    const salt = line({ id: "l3", ingredient_name: "Salt", quantity: 20 });
    const next = recipeEditorReducer(stateWith([flour, salt]), {
      type: "updateLine",
      lineId: "l1",
      patch: { quantity: 2000 },
    });
    expect(Number(next.lines.find((l) => l.id === "l3")?.quantity)).toBe(20);
  });

  it("fjerner delens linjer når delen slettes", () => {
    const next = recipeEditorReducer(stateWith([flour, water]), { type: "removePart", partId: "p1" });
    expect(next.parts).toHaveLength(0);
    expect(next.lines).toHaveLength(0);
  });

  it("dupliserer en del med egne linje-id-er", () => {
    const next = recipeEditorReducer(stateWith([flour, water]), { type: "duplicatePart", partId: "p1" });
    expect(next.parts).toHaveLength(2);
    const newPartId = next.parts[1].id;
    const copied = next.lines.filter((l) => l.recipe_part_id === newPartId);
    expect(copied).toHaveLength(2);
    expect(copied.map((l) => l.id)).not.toContain("l1");
  });

  it("gir prosentlinjer en prosent ved bytte til prosentmodus", () => {
    const salt = line({ id: "l3", ingredient_name: "Salt", quantity: 20 });
    const next = recipeEditorReducer(stateWith([flour, salt]), {
      type: "setEntryMode",
      partId: "p1",
      mode: "percent",
    });
    const updatedSalt = next.lines.find((l) => l.id === "l3");
    expect(updatedSalt?.entry_mode).toBe("percent");
    expect(Number(updatedSalt?.bakers_percent)).toBeCloseTo(2, 3);
  });

  it("gjenoppretting av utkast regnes som ulagret arbeid", () => {
    const restored = recipeEditorReducer(emptyEditorState, {
      type: "restore",
      state: { ...stateWith([flour]), dirty: false },
    });
    expect(restored.dirty).toBe(true);
  });
});
