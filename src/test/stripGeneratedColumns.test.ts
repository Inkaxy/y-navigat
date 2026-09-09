import { describe, it, expect } from "vitest";
import { stripGeneratedColumns } from "@/ravarer/hooks/useNutrition";

describe("stripGeneratedColumns", () => {
  it("fjerner genererte kolonner før insert/update/upsert", () => {
    const input = {
      raw_material_id: "rm-1",
      energy_kcal: 100,
      is_complete: true,
      is_water: false,
      food_name_norm: "melk",
      search_keywords_norm: "melk kumelk",
    };
    const result = stripGeneratedColumns(input);
    expect(result).toEqual({ raw_material_id: "rm-1", energy_kcal: 100 });
    expect(result).not.toHaveProperty("is_complete");
    expect(result).not.toHaveProperty("is_water");
    expect(result).not.toHaveProperty("food_name_norm");
    expect(result).not.toHaveProperty("search_keywords_norm");
  });
});
