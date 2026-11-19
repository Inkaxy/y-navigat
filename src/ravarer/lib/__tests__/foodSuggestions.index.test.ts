import { describe, it, expect } from "vitest";
import { suggestFoods, type FoodCandidate } from "@/ravarer/lib/foodSuggestions";

const table = (): FoodCandidate[] => [
  { food_id: "1", food_name: "Hvetemel, siktet", food_group_name: "Mel", search_keywords: ["hvetemel"] },
  { food_id: "2", food_name: "Hvetemel, sammalt, fint", food_group_name: "Mel", search_keywords: [] },
  { food_id: "3", food_name: "Sukker, hvitt", food_group_name: "Sukker og honning", search_keywords: ["melis"] },
];

describe("suggestFoods med forhåndsindeks", () => {
  it("gir samme forslag andre gang for samme tabell, uten å dele objekter med kalleren", () => {
    const foods = table();
    const rm = { name: "REGAL HVETEMEL 25 KG", category: "Mel og korn" };
    const first = suggestFoods(rm, foods);
    first[0].confidence = 0;
    const second = suggestFoods(rm, foods);
    expect(second[0]?.food_id).toBe("1");
    expect(second[0]?.confidence).toBeGreaterThan(0);
  });

  it("bruker ikke gamle forslag når tabellen lastes på nytt", () => {
    const rm = { name: "REGAL HVETEMEL 25 KG", category: "Mel og korn" };
    expect(suggestFoods(rm, table())[0]?.food_id).toBe("1");
    const reloaded = table().filter((f) => f.food_id !== "1");
    expect(suggestFoods(rm, reloaded).map((s) => s.food_id)).not.toContain("1");
  });

  it("skiller forslag for ulike grenser på samme råvare", () => {
    const foods = table();
    const rm = { name: "HVETEMEL" };
    expect(suggestFoods(rm, foods, 1)).toHaveLength(1);
    expect(suggestFoods(rm, foods, 3).length).toBeGreaterThan(1);
  });
});
