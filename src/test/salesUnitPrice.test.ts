import { describe, expect, it } from "vitest";
import { MISSING_WEIGHT_REASON, perKg, salesUnitWeight } from "@/varer/lib/salesUnitPrice";

describe("kilopris for koblet vare", () => {
  it("bekreftet vekt på koblingen går foran varekortet", () => {
    expect(salesUnitWeight({ sales_unit_weight_g: 750 }, { weight_per_unit_grams: 700 })).toEqual({ grams: 750, source: "kobling", reason: null });
  });

  it("uten vekt på koblingen brukes vekten på varen", () => {
    expect(salesUnitWeight({ sales_unit_weight_g: null }, { weight_per_unit_grams: "500" })).toEqual({ grams: 500, source: "vare", reason: null });
  });

  it("mangler vekten er den ukjent med forklaring — 0 og negative tall godtas ikke", () => {
    for (const w of [null, 0, -10, ""]) {
      const r = salesUnitWeight({ sales_unit_weight_g: w }, { weight_per_unit_grams: w });
      expect(r.grams).toBeNull();
      expect(r.reason).toBe(MISSING_WEIGHT_REASON);
    }
  });

  it("pris / vekt per salgsenhet", () => {
    expect(perKg(45, 750)).toBeCloseTo(60, 10);
    expect(perKg(22, 500)).toBeCloseTo(44, 10);
  });

  it("ukjent pris eller vekt gir null, aldri 0", () => {
    expect(perKg(null, 750)).toBeNull();
    expect(perKg(45, null)).toBeNull();
    expect(perKg(45, 0)).toBeNull();
    expect(perKg(-1, 750)).toBeNull();
    expect(perKg(0, 750)).toBe(0);
  });
});
