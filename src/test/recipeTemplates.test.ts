import { describe, it, expect } from "vitest";
import { filterNonTemplateRecipes, filterTemplateRecipes } from "@/varer/lib/recipeTemplates";

describe("filterNonTemplateRecipes / filterTemplateRecipes", () => {
  const rows = [
    { id: "1", is_template: false },
    { id: "2", is_template: true },
    { id: "3", is_template: null },
  ];

  it("beholder kun ikke-maler i den vanlige lista", () => {
    expect(filterNonTemplateRecipes(rows).map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("beholder kun maler for «Ny fra mal»", () => {
    expect(filterTemplateRecipes(rows).map((r) => r.id)).toEqual(["2"]);
  });
});
