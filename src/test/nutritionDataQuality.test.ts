import { describe, it, expect } from "vitest";
import { normalizeForSearch, rankBySearch, trigramSimilarity } from "@/lib/textSimilarity";
import { suggestFoods } from "@/ravarer/lib/foodSuggestions";
import { suggestDeclarationNameLocal } from "@/ravarer/lib/declarationName";
import {
  changedNutritionFields,
  energyMismatch,
  kcalFromKj,
  normalizeNutritionSource,
  resolveSourceOnSave,
} from "@/ravarer/lib/nutritionSource";
import { diffAllergens } from "@/ravarer/lib/allergenDiff";

describe("textSimilarity", () => {
  it("fjerner diakritika i normalisering", () => {
    expect(normalizeForSearch("Crème Fraîche")).toBe("creme fraiche");
  });

  it("lar «creme» treffe «crème»", () => {
    const rows = [{ name: "Crème fraîche" }, { name: "Havregryn" }];
    const hits = rankBySearch(rows, "creme", (r) => [r.name]);
    expect(hits[0]?.name).toBe("Crème fraîche");
  });

  it("gir høyere likhet for nære ord enn fjerne", () => {
    expect(trigramSimilarity("hvetemel", "hvetemel siktet")).toBeGreaterThan(
      trigramSimilarity("hvetemel", "kakaopulver"),
    );
  });
});

describe("suggestDeclarationNameLocal", () => {
  it("fjerner merke og pakningsstørrelse", () => {
    expect(suggestDeclarationNameLocal("REGAL HVETEMEL 25 KG SEKK").toLowerCase()).toContain("hvetemel");
    expect(suggestDeclarationNameLocal("REGAL HVETEMEL 25 KG SEKK").toLowerCase()).not.toContain("25");
  });
});

describe("suggestFoods", () => {
  const foods = [
    { food_id: "1", food_name: "Hvetemel, siktet", food_group_name: "Mel", search_keywords: ["hvetemel"] },
    { food_id: "2", food_name: "Sukker", food_group_name: "Sukker og honning", search_keywords: [] },
    { food_id: "3", food_name: "Kakaopulver", food_group_name: "Diverse ingredienser", search_keywords: [] },
  ];

  it("foreslår riktig matvare for et innkjøpsnavn", () => {
    const hits = suggestFoods({ name: "REGAL HVETEMEL 25 KG", category: "mel" }, foods);
    expect(hits[0]?.food_id).toBe("1");
    expect(hits[0]?.confidence).toBeGreaterThan(0.5);
  });

  it("gir ingen forslag for emballasje", () => {
    expect(suggestFoods({ name: "Kartong 30x40", category: "Emballasje" }, foods)).toEqual([]);
  });
});

describe("kilde for næringsdata", () => {
  it("leser gamle kildeverdier", () => {
    expect(normalizeNutritionSource("manual")).toBe("manuell");
    expect(normalizeNutritionSource("leverandør_db")).toBe("datablad");
  });

  it("setter kilden til manuell når et tall fra Matvaretabellen rettes", () => {
    const before = { fat_g: 1, protein_g: 10 };
    const after = { fat_g: 2, protein_g: 10 };
    const changed = changedNutritionFields(before, after);
    expect(changed).toEqual(["fat_g"]);
    expect(
      resolveSourceOnSave({ existingSource: "matvaretabellen", draftSource: "matvaretabellen", changedFields: changed }),
    ).toBe("manuell");
  });

  it("beholder kilden når ingenting er endret", () => {
    expect(
      resolveSourceOnSave({ existingSource: "matvaretabellen", draftSource: "matvaretabellen", changedFields: [] }),
    ).toBe("matvaretabellen");
  });
});

describe("energi", () => {
  it("regner kcal fra kJ", () => {
    expect(kcalFromKj(1000)).toBeCloseTo(239, 0);
  });

  it("flagger avvik over 5 prosent", () => {
    expect(energyMismatch(1000, 239).mismatch).toBe(false);
    expect(energyMismatch(1000, 400).mismatch).toBe(true);
  });
});

describe("diffAllergens", () => {
  it("finner lagt til, endret, fjernet og forkastet", () => {
    const diff = diffAllergens(
      [
        { allergen: "milk", presence: "contains" },
        { allergen: "eggs", presence: "contains" },
      ],
      [
        { allergen: "milk", presence: "may_contain" },
        { allergen: "soybeans", presence: "contains" },
        { allergen: "tullball", presence: "contains" },
      ],
    );
    expect(diff.added.map((a) => a.allergen)).toEqual(["soybeans"]);
    expect(diff.changed.map((c) => c.allergen)).toEqual(["milk"]);
    expect(diff.removed.map((r) => r.allergen)).toEqual(["eggs"]);
    expect(diff.rejected).toEqual(["tullball"]);
  });
});
