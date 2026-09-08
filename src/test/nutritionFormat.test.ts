import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MANDATORY_NUTRIENTS,
  NUTRIENT_LABEL,
  NUTRITION_TABLE_ROWS,
  formatEnergyRow,
  formatNutrient,
  storeNutrient,
} from "@/varer/lib/nutritionFormat";
import { nutritionValueText } from "@/varer/components/recipes/label/labelShared";

describe("nutritionFormat — Mattilsynets avrundingsregler", () => {
  it("energi står på én rad med hele tall", () => {
    expect(formatEnergyRow(1050.4, 249.6)).toBe("1 050 kJ / 250 kcal");
  });

  it("fett, karbohydrat og protein: hele tall fra 10, ellers én desimal", () => {
    expect(formatNutrient("fat_g", 12.4)).toBe("12 g");
    expect(formatNutrient("carbs_g", 9.44)).toBe("9,4 g");
    expect(formatNutrient("protein_g", 0.3)).toBe("< 0,5 g");
  });

  it("mettet fett og sukkerarter under 0,1 g", () => {
    expect(formatNutrient("saturated_fat_g", 0.04)).toBe("< 0,1 g");
    expect(formatNutrient("sugars_g", 0.05)).toBe("< 0,1 g");
  });

  it("salt: én desimal fra 1 g, to under, 0 g under 0,0125", () => {
    expect(formatNutrient("salt_g", 1.24)).toBe("1,2 g");
    expect(formatNutrient("salt_g", 0.456)).toBe("0,46 g");
    expect(formatNutrient("salt_g", 0.01)).toBe("0 g");
  });

  it("ordlyden følger vedlegg XV", () => {
    expect(NUTRIENT_LABEL.carbs_g).toBe("Karbohydrat");
    expect(NUTRIENT_LABEL.saturated_fat_g).toBe("hvorav mettede fettsyrer");
    expect(NUTRITION_TABLE_ROWS[0]).toMatchObject({ key: "energy", label: "Energi" });
    expect(MANDATORY_NUTRIENTS).not.toContain("fiber_g");
  });

  it("lagrede verdier beholder tre desimaler", () => {
    expect(storeNutrient(1.23456)).toBe(1.235);
    expect(storeNutrient(null)).toBeNull();
  });

  it("modulen er byte-identisk med edge-speilet", () => {
    const a = readFileSync("src/varer/lib/nutritionFormat.ts");
    const b = readFileSync("supabase/functions/_shared/nutritionFormat.ts");
    expect(a.equals(b)).toBe(true);
  });
});

describe("næringstabellen i UI", () => {
  it("viser aldri 0,00 g salt når raden mangler", () => {
    expect(nutritionValueText("salt_g", { salt_g: null })).toBe("ukjent");
    expect(nutritionValueText("salt_g", null)).toBe("ukjent");
    expect(nutritionValueText("fat_g", { fat_g: null })).toBe("—");
  });

  it("skalerer til porsjon", () => {
    expect(nutritionValueText("protein_g", { protein_g: 10 }, 0.5)).toBe("5,0 g");
  });
});
