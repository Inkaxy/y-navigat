import { describe, expect, it } from "vitest";
import {
  basisIsComplete,
  computeSalesUnitBasis,
  isSalesUnitBasis,
} from "@/varer/lib/recipeLinkBasis";

const bolleBatch = {
  unitCount: 40,
  totalDoughG: 4000,
  finalWeightG: 3600,
  pieceWeightG: 90,
  totalCost: 200,
  costIncomplete: false,
};

describe("computeSalesUnitBasis", () => {
  it("krever bekreftet salgsenhet før noe beregnes", () => {
    const r = computeSalesUnitBasis({}, bolleBatch);
    expect(r.basis).toBeNull();
    expect(r.costPerSalesUnit).toBeNull();
    expect(r.missing.join(" ")).toContain("Salgsenheten er ikke bekreftet");
  });

  it("regner per stykk", () => {
    const r = computeSalesUnitBasis({ sales_unit_basis: "stk" }, bolleBatch);
    expect(r.unitsPerSalesUnit).toBe(1);
    expect(r.costPerUnit).toBeCloseTo(5);
    expect(r.costPerSalesUnit).toBeCloseTo(5);
    expect(r.weightPerSalesUnitG).toBe(90);
    expect(basisIsComplete(r)).toBe(true);
  });

  it("regner flerpakning med bekreftet antall (8 boller per pakke)", () => {
    const r = computeSalesUnitBasis(
      { sales_unit_basis: "flerpakk", units_per_sales_unit: 8 },
      bolleBatch,
    );
    expect(r.unitsPerSalesUnit).toBe(8);
    expect(r.costPerSalesUnit).toBeCloseTo(40);
    expect(r.weightPerSalesUnitG).toBe(720);
    expect(r.salesUnitsPerBatch).toBeCloseTo(5);
    expect(r.missing).toEqual([]);
  });

  it("utleder aldri antall per pakke når det ikke er bekreftet", () => {
    const r = computeSalesUnitBasis({ sales_unit_basis: "flerpakk" }, bolleBatch);
    expect(r.unitsPerSalesUnit).toBeNull();
    expect(r.costPerSalesUnit).toBeNull();
    expect(r.missing.join(" ")).toContain("Antall enheter per salgsenhet");
  });

  it("stopper når råvarekostnaden er ufullstendig", () => {
    const r = computeSalesUnitBasis(
      { sales_unit_basis: "stk" },
      { ...bolleBatch, costIncomplete: true },
    );
    expect(r.costPerUnit).toBeNull();
    expect(r.costPerSalesUnit).toBeNull();
    expect(basisIsComplete(r)).toBe(false);
    expect(r.missing.join(" ")).toContain("ufullstendig");
  });

  it("regner vektbasert salgsenhet mot batchens utbytte", () => {
    const r = computeSalesUnitBasis(
      { sales_unit_basis: "vekt", sales_unit_weight_g: 900 },
      bolleBatch,
    );
    // 200 kr / 3600 g * 900 g = 50 kr
    expect(r.costPerSalesUnit).toBeCloseTo(50);
    expect(r.weightPerSalesUnitG).toBe(900);
  });

  it("krever bekreftet vekt for vektbasert salgsenhet", () => {
    const r = computeSalesUnitBasis({ sales_unit_basis: "vekt" }, bolleBatch);
    expect(r.weightPerSalesUnitG).toBeNull();
    expect(r.missing.join(" ")).toContain("Vekt per salgsenhet");
  });

  it("bruker koblingens overstyringer foran oppskriftens tall", () => {
    const r = computeSalesUnitBasis(
      { sales_unit_basis: "stk", units_per_batch_override: 50, yield_weight_g_override: 5000 },
      { ...bolleBatch, pieceWeightG: null },
    );
    expect(r.unitsPerBatch).toBe(50);
    expect(r.weightPerUnitG).toBeCloseTo(100);
    expect(r.costPerUnit).toBeCloseTo(4);
  });

  it("melder manglende utbytte i stedet for å gjette", () => {
    const r = computeSalesUnitBasis(
      { sales_unit_basis: "stk" },
      { unitCount: null, totalDoughG: null, pieceWeightG: null, totalCost: 100, costIncomplete: false },
    );
    expect(r.unitsPerBatch).toBeNull();
    expect(r.costPerSalesUnit).toBeNull();
    expect(r.missing.join(" ")).toContain("antall emner");
  });

  it("godtar bare kjente salgsenhetsgrunnlag", () => {
    expect(isSalesUnitBasis("flerpakk")).toBe(true);
    expect(isSalesUnitBasis("kartong")).toBe(false);
  });
});
