import { describe, it, expect } from "vitest";
import {
  calculateRecipeMetrics,
  fmtKr,
  fmtPct,
  type RecipeMetricsInput,
} from "@/varer/lib/recipeCalc";

function baseInput(overrides: Partial<RecipeMetricsInput> = {}): RecipeMetricsInput {
  return {
    ingredients: [
      // 1 kg mel a 20 kr/kg
      { quantity: 1000, unit: "g", unit_cost_per_kg: 20 },
      // 0,5 liter melk a 16 kr/liter
      { quantity: 0.5, unit: "liter", unit_cost_per_kg: 16 },
    ],
    labor: [{ hours: 2, hourly_rate: 300 }],
    packaging: [{ quantity: 10, unit_price: 1.5 }],
    units_per_batch: 10,
    hourly_rate_default: 250,
    prices: { netto: 20, engros: 25, engros_pkg: 30, egne_utsalg: 40 },
    vat_rate: 0.15,
    target_db_pct: 40,
    ...overrides,
  };
}

describe("calculateRecipeMetrics", () => {
  it("summerer råvare-, lønns- og emballasjekost", () => {
    const m = calculateRecipeMetrics(baseInput());
    expect(m.total_raw_cost).toBeCloseTo(20 + 8, 6); // 1 kg * 20 + 0,5 l * 16
    expect(m.total_labor_cost).toBeCloseTo(600, 6);
    expect(m.total_packaging_cost).toBeCloseTo(15, 6);
    expect(m.total_cost).toBeCloseTo(628, 6); // emballasje inngår ikke i total_cost
  });

  it("fordeler kost per enhet på antall i batch", () => {
    const m = calculateRecipeMetrics(baseInput());
    expect(m.cost_per_unit).toBeCloseTo(62.8, 6);
    expect(m.packaging_per_unit).toBeCloseTo(1.5, 6);
    expect(m.ingredients_per_unit).toBeCloseTo(2.8, 6);
  });

  it("bruker minst 1 enhet per batch selv ved 0", () => {
    const m = calculateRecipeMetrics(baseInput({ units_per_batch: 0 }));
    expect(m.units_per_batch).toBe(1);
    expect(m.cost_per_unit).toBeCloseTo(628, 6);
  });

  it("legger på svinn-prosent på ingredienskost", () => {
    const m = calculateRecipeMetrics(
      baseInput({
        ingredients: [{ quantity: 1, unit: "kg", unit_cost_per_kg: 100, waste_percent: 10 }],
        labor: [],
        packaging: [],
      }),
    );
    expect(m.total_raw_cost).toBeCloseTo(110, 6);
  });

  it("lar override_total overstyre all kostberegning", () => {
    const m = calculateRecipeMetrics(
      baseInput({
        ingredients: [
          { quantity: 999, unit: "kg", unit_cost_per_kg: 999, override_total: 42 },
        ],
        labor: [],
        packaging: [],
      }),
    );
    expect(m.total_raw_cost).toBe(42);
  });

  it("regner stk som pris per enhet, ikke per kg", () => {
    const m = calculateRecipeMetrics(
      baseInput({
        ingredients: [{ quantity: 4, unit: "stk", unit_cost_per_kg: 2.5 }],
        labor: [],
        packaging: [],
      }),
    );
    expect(m.total_raw_cost).toBeCloseTo(10, 6);
  });

  it("faller tilbake til default timesats når linja mangler sats", () => {
    const m = calculateRecipeMetrics(
      baseInput({ labor: [{ hours: 3, hourly_rate: null }], ingredients: [], packaging: [] }),
    );
    expect(m.total_labor_cost).toBeCloseTo(750, 6);
  });

  it("regner vekt kun for vektbaserte enheter", () => {
    const m = calculateRecipeMetrics(
      baseInput({
        ingredients: [
          { quantity: 500, unit: "g", unit_cost_per_kg: 10 },
          { quantity: 1, unit: "kg", unit_cost_per_kg: 10 },
          { quantity: 3, unit: "stk", unit_cost_per_kg: 10 },
        ],
        units_per_batch: 5,
      }),
    );
    expect(m.total_weight_g).toBeCloseTo(1500, 6);
    expect(m.weight_per_unit_g).toBeCloseTo(300, 6);
  });

  it("bruker oppgitt yield_weight_g framfor beregnet vekt", () => {
    const m = calculateRecipeMetrics(baseInput({ yield_weight_g: 250 }));
    expect(m.weight_per_unit_g).toBe(250);
  });

  describe("prismetrikker", () => {
    const m = calculateRecipeMetrics(
      baseInput({
        ingredients: [{ quantity: 1, unit: "kg", unit_cost_per_kg: 10 }],
        labor: [],
        packaging: [{ quantity: 10, unit_price: 1 }],
        units_per_batch: 10,
        prices: { netto: 10, engros: 2, engros_pkg: null, egne_utsalg: 5 },
        target_db_pct: 40,
        vat_rate: 0.15,
      }),
    );
    // cost_per_unit = 1, packaging_per_unit = 1, raw_per_unit = 1

    it("regner db, dg og bruttomargin", () => {
      expect(m.prices.netto.db).toBeCloseTo(8, 6);
      expect(m.prices.netto.dg_pct).toBeCloseTo(0.8, 6);
      expect(m.prices.netto.brutto_pct).toBeCloseTo(0.9, 6);
    });

    it("legger mva på pris inkl. mva", () => {
      expect(m.prices.netto.price_inc_vat).toBeCloseTo(11.5, 6);
    });

    it("setter status etter dekningsgrad mot mål", () => {
      expect(m.prices.netto.status).toBe("ok"); // 80 % >= 40 %
      expect(m.prices.engros.status).toBe("bad"); // db = 0 -> langt under mål
      expect(m.prices.engros_pkg.status).toBe("bad"); // pris 0
      expect(m.prices.egne_utsalg.status).toBe("ok");
    });

    it("gir 0-metrikker uten pris", () => {
      expect(m.prices.engros_pkg.price).toBe(0);
      expect(m.prices.engros_pkg.dg_pct).toBe(0);
      expect(m.prices.engros_pkg.brutto_pct).toBe(0);
    });
  });
});

describe("formatering", () => {
  it("formaterer kroner med norsk desimalkomma", () => {
    expect(fmtKr(12.5)).toBe("12,50");
    expect(fmtKr(12.345, 1)).toBe("12,3");
    expect(fmtKr(null)).toBe("—");
    expect(fmtKr(undefined)).toBe("—");
  });

  it("formaterer prosent fra andel", () => {
    expect(fmtPct(0.4)).toBe("40 %");
    expect(fmtPct(0.4567, 1)).toBe("45,7 %");
    expect(fmtPct(null)).toBe("—");
  });
});
