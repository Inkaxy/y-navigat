import { describe, it, expect } from "vitest";
import {
  mayRemoveAllergens,
  preservedComponentNames,
  replaceableComponentIds,
  shouldWriteAppliedStatus,
  type ExistingComponent,
} from "../../../../supabase/functions/_shared/datasheet-apply-rules";

const comps: ExistingComponent[] = [
  { id: "1", component_raw_material_id: "rm-a", primary_ingredient_name: "Hvetemel", suggested_by_ai: true },
  { id: "2", component_raw_material_id: null, primary_ingredient_name: "Salt", suggested_by_ai: true },
  { id: "3", component_raw_material_id: null, primary_ingredient_name: "Gjær", suggested_by_ai: false },
  { id: "4", component_raw_material_id: null, primary_ingredient_name: "Vann", suggested_by_ai: null },
];

describe("komponentregler", () => {
  it("erstatter bare tidligere AI-forslag uten kobling", () => {
    expect(replaceableComponentIds(comps)).toEqual(["2"]);
  });

  it("beholder koblede og manuelle komponenter", () => {
    expect(preservedComponentNames(comps)).toEqual(new Set(["hvetemel", "gjær", "vann"]));
  });
});

describe("statusregler", () => {
  it("markerer ikke anvendt når nullstillingen feiler", () => {
    expect(shouldWriteAppliedStatus(0, true)).toBe(false);
  });

  it("markerer ikke anvendt når noe annet allerede feilet", () => {
    expect(shouldWriteAppliedStatus(2, false)).toBe(false);
  });

  it("markerer anvendt når alt gikk gjennom", () => {
    expect(shouldWriteAppliedStatus(0, false)).toBe(true);
  });
});

describe("allergenfjerning", () => {
  it("krever eksplisitt godkjenning", () => {
    expect(mayRemoveAllergens(["allergens"], 0)).toBe(false);
    expect(mayRemoveAllergens(["allergens", "allergen_removals"], 0)).toBe(true);
  });

  it("blokkeres av forkastede verdier", () => {
    expect(mayRemoveAllergens(["allergens", "allergen_removals"], 1)).toBe(false);
  });
});
