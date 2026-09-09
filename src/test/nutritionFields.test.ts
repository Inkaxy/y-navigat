import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MANDATORY_NUTRITION_FIELD_KEYS,
  NUTRITION_FIELDS,
  NUTRITION_FIELD_KEYS,
  nutritionFieldLabel,
} from "@/varer/lib/nutritionFields";

describe("nutritionFields — katalog over næringsfeltene", () => {
  it("inneholder alle ni feltene fra vedlegg XV", () => {
    expect(NUTRITION_FIELD_KEYS).toEqual([
      "energy_kj", "energy_kcal", "fat_g", "saturated_fat_g",
      "carbs_g", "sugars_g", "fiber_g", "protein_g", "salt_g",
    ]);
  });

  it("kostfiber er ikke pliktfelt, resten er", () => {
    expect(MANDATORY_NUTRITION_FIELD_KEYS).not.toContain("fiber_g");
    expect(MANDATORY_NUTRITION_FIELD_KEYS).toContain("salt_g");
  });

  it("ordlyden følger vedlegg XV", () => {
    expect(nutritionFieldLabel("carbs_g")).toBe("Karbohydrat");
    expect(nutritionFieldLabel("saturated_fat_g")).toBe("hvorav mettede fettsyrer");
  });

  it("energi har egne enheter for kJ og kcal", () => {
    expect(NUTRITION_FIELDS.find((f) => f.key === "energy_kj")?.unit).toBe("kJ");
    expect(NUTRITION_FIELDS.find((f) => f.key === "energy_kcal")?.unit).toBe("kcal");
  });

  it("modulen er byte-identisk med edge-speilet", () => {
    const a = readFileSync("src/varer/lib/nutritionFields.ts");
    const b = readFileSync("supabase/functions/_shared/nutritionFields.ts");
    expect(a.equals(b)).toBe(true);
  });
});
