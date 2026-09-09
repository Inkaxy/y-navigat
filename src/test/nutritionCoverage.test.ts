import { describe, expect, it } from "vitest";
import {
  manualFieldOverrideLabel,
  parseNutritionCoverageSummary,
  sortCoverageRows,
  statusChipLabel,
  type CoverageRow,
} from "@/ravarer/lib/nutritionCoverage";

function row(partial: Partial<CoverageRow>): CoverageRow {
  return {
    raw_material_id: "id",
    name: "Vare",
    category: null,
    status: "mangler",
    source: null,
    matvaretabellen_food_id: null,
    manual_field_count: 0,
    used_in_recipes: false,
    recipe_grams: 0,
    purchase_12m: 0,
    needs_nutrition: true,
    ...partial,
  };
}

describe("statusChipLabel", () => {
  it("oversetter kjente statuser", () => {
    expect(statusChipLabel("koblet")).toBe("Koblet");
    expect(statusChipLabel("datablad")).toBe("Datablad");
    expect(statusChipLabel("manuell")).toBe("Manuell");
    expect(statusChipLabel("analyse")).toBe("Analyse");
    expect(statusChipLabel("mangler")).toBe("Mangler");
    expect(statusChipLabel(null)).toBe("Mangler");
  });
});

describe("manualFieldOverrideLabel", () => {
  it("viser bare tekst når felt er overstyrt", () => {
    expect(manualFieldOverrideLabel(0)).toBeNull();
    expect(manualFieldOverrideLabel(null)).toBeNull();
    expect(manualFieldOverrideLabel(3)).toBe("3 felt overstyrt");
  });
});

describe("sortCoverageRows", () => {
  it("setter mangler-rader med bruk i oppskrift og høyt forbruk først", () => {
    const rows = [
      row({ raw_material_id: "a", status: "koblet", name: "A" }),
      row({ raw_material_id: "b", status: "mangler", used_in_recipes: false, recipe_grams: 0, name: "B" }),
      row({ raw_material_id: "c", status: "mangler", used_in_recipes: true, recipe_grams: 500, name: "C" }),
      row({ raw_material_id: "d", status: "mangler", used_in_recipes: true, recipe_grams: 100, purchase_12m: 900, name: "D" }),
    ];
    const sorted = sortCoverageRows(rows).map((r) => r.raw_material_id);
    expect(sorted).toEqual(["c", "d", "b", "a"]);
  });
});

describe("parseNutritionCoverageSummary", () => {
  it("tolker Json trygt uten å anta felt finnes", () => {
    const parsed = parseNutritionCoverageSummary({
      covered: { recipe_weighted_pct: 87.5 },
      by_status: { koblet: 10, mangler: "2" },
    });
    expect(parsed.covered.recipe_weighted_pct).toBe(87.5);
    expect(parsed.by_status).toEqual({ koblet: 10, mangler: 2 });
  });

  it("gir trygge fallbacker for tomt/ugyldig input", () => {
    const parsed = parseNutritionCoverageSummary(null);
    expect(parsed.covered.recipe_weighted_pct).toBe(0);
    expect(parsed.by_status).toEqual({});
  });
});
