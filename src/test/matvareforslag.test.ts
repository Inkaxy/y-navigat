import { describe, it, expect } from "vitest";
import { normalizeSearch } from "@/ravarer/lib/rawMaterialViews";

/** Samme filtreringsregel som FoodPickerDialog bruker på treff fra matvaretabellen_suggest. */
function filterSuggestions<T extends { score: number }>(rows: T[]): T[] {
  return rows.filter(r => r.score >= 0.4);
}

describe("matvareforslag", () => {
  it("normaliserer NFD og fjerner diakritika", () => {
    expect(normalizeSearch("Crème fraîche")).toBe("creme fraiche");
    expect(normalizeSearch("Blåbær")).toBe("blåbær");
  });

  it("skjuler treff med score under 0,4", () => {
    const rows = [{ score: 0.9, name: "a" }, { score: 0.39, name: "b" }, { score: 0.4, name: "c" }];
    expect(filterSuggestions(rows).map(r => r.name)).toEqual(["a", "c"]);
  });
});
