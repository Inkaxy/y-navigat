import { describe, it, expect } from "vitest";
import {
  computeTotals,
  convertToGrams,
  fromGrams,
  lineToGrams,
  type BakersLine,
} from "@/varer/lib/bakers";

function line(partial: Partial<BakersLine>): BakersLine {
  return {
    id: partial.id ?? "l1",
    recipe_part_id: "p1",
    raw_material_id: partial.raw_material_id ?? "rm1",
    quantity: partial.quantity ?? 1,
    unit: partial.unit ?? "kg",
    ingredient_name: partial.ingredient_name,
    _rm: partial._rm ?? null,
    is_flour_override: partial.is_flour_override,
  };
}

describe("convertToGrams", () => {
  it("er nøyaktig for g og kg", () => {
    expect(convertToGrams(500, "g")).toEqual({ grams: 500, exact: true });
    expect(convertToGrams(1.5, "kg")).toEqual({ grams: 1500, exact: true });
  });

  it("bruker kjent tetthet for volum", () => {
    const r = convertToGrams(2, "l", { densityGPerMl: 0.92 });
    expect(r.exact).toBe(true);
    expect(r.grams).toBeCloseTo(1840, 6);
  });

  it("antar IKKE vann for ukjent væske", () => {
    const r = convertToGrams(1, "l");
    expect(r.exact).toBe(false);
    expect(r.grams).toBe(0);
    expect(r.reason).toMatch(/tetthet/i);
  });

  it("bruker stykkvekt når den finnes, ellers ufullstendig", () => {
    expect(convertToGrams(10, "stk", { pieceWeightG: 45 })).toEqual({ grams: 450, exact: true });
    const r = convertToGrams(10, "stk");
    expect(r.exact).toBe(false);
    expect(r.reason).toMatch(/stykk/i);
  });
});

describe("fromGrams", () => {
  it("beholder g/kg-adferden", () => {
    expect(fromGrams(1500, "kg")).toBe(1.5);
    expect(fromGrams(250, "g")).toBe(250);
  });

  it("gir NaN når omregningen er ukjent", () => {
    expect(Number.isNaN(fromGrams(1000, "l"))).toBe(true);
    expect(Number.isNaN(fromGrams(1000, "stk"))).toBe(true);
    expect(fromGrams(1000, "l", { densityGPerMl: 1 })).toBeCloseTo(1, 9);
    expect(fromGrams(900, "stk", { pieceWeightG: 45 })).toBe(20);
  });
});

describe("lineToGrams", () => {
  it("bruker unit_weight_grams som stykkvekt", () => {
    const r = lineToGrams(line({ quantity: 4, unit: "stk", _rm: { id: "rm", name: "Egg", unit_weight_grams: 58 } }));
    expect(r).toEqual({ grams: 232, exact: true });
  });

  it("regner rent vann som 1 g/ml", () => {
    const r = lineToGrams(line({ quantity: 1, unit: "l", _rm: { id: "rm", name: "Vann", water_content_pct: 100 } }));
    expect(r).toEqual({ grams: 1000, exact: true });
  });

  it("lar en annen væske uten tetthet bli ufullstendig", () => {
    const r = lineToGrams(line({ quantity: 1, unit: "l", _rm: { id: "rm", name: "Rapsolje" } }));
    expect(r.exact).toBe(false);
  });
});

describe("computeTotals", () => {
  it("markerer beregningen ufullstendig og gir ikke antall emner", () => {
    const lines = [
      line({ id: "a", quantity: 10, unit: "kg", _rm: { id: "m", name: "Hvetemel", grain_classification: "wheat" } }),
      line({ id: "b", quantity: 2, unit: "l", _rm: { id: "o", name: "Rapsolje" } }),
    ];
    const totals = computeTotals(lines, 500);
    expect(totals.incomplete).toBe(true);
    expect(totals.warnings.length).toBe(1);
    expect(totals.unitCount).toBeNull();
  });

  it("gir antall emner når alle mengder er kjent", () => {
    const lines = [
      line({ id: "a", quantity: 10, unit: "kg", _rm: { id: "m", name: "Hvetemel", grain_classification: "wheat" } }),
      line({ id: "b", quantity: 6, unit: "l", _rm: { id: "v", name: "Vann", water_content_pct: 100 } }),
    ];
    const totals = computeTotals(lines, 1000);
    expect(totals.incomplete).toBe(false);
    expect(totals.unitCount).toBe(16);
    expect(totals.hydrationPct).toBeCloseTo(60, 6);
  });
});
