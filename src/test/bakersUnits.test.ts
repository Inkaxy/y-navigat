import { describe, it, expect } from "vitest";
import {
  computeTotals,
  convertToGrams,
  fromGrams,
  gramsFromPercent,
  isLineConvertible,
  lineFromGrams,
  lineToGrams,
  scaleLines,
  scaledSummary,
  type BakersLine,
} from "@/varer/lib/bakers";
import { costPerKg, costPerKgBlockedReason } from "@/varer/lib/halvfabrikat";

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

// ===== Regresjoner funnet i etterkontrollen 7. september =====

describe("linjeomregning begge veier (RecipePartCard-regresjonen)", () => {
  const water = line({ id: "w", quantity: 1, unit: "l", _rm: { id: "v", name: "Vann" } });

  it("1 l rent vann er 1000 g og 1000 g er 1 l", () => {
    expect(lineToGrams(water)).toEqual({ grams: 1000, exact: true });
    expect(lineFromGrams(1000, water)).toBeCloseTo(1, 9);
  });

  it("60 % av 1 kg mel gir 0,6 l vann", () => {
    expect(lineFromGrams(gramsFromPercent(60, 1000), water)).toBeCloseTo(0.6, 9);
  });

  it("kjent stykkvekt virker begge veier", () => {
    const egg = line({ quantity: 4, unit: "stk", _rm: { id: "e", name: "Egg", unit_weight_grams: 58 } });
    expect(lineToGrams(egg).grams).toBe(232);
    expect(lineFromGrams(232, egg)).toBe(4);
    expect(isLineConvertible(egg)).toBe(true);
  });

  it("kokosvann antas ikke å være rent vann", () => {
    const coco = line({ quantity: 1, unit: "l", _rm: { id: "k", name: "Kokosvann" } });
    expect(lineToGrams(coco).exact).toBe(false);
    expect(Number.isNaN(lineFromGrams(1000, coco))).toBe(true);
    expect(isLineConvertible(coco)).toBe(false);
  });

  it("ukjent væske gir ukjent omregning begge veier", () => {
    const oil = line({ quantity: 1, unit: "l", _rm: { id: "o", name: "Rapsolje" } });
    expect(oil && lineToGrams(oil).exact).toBe(false);
    expect(Number.isNaN(lineFromGrams(500, oil))).toBe(true);
  });
});

describe("scaledSummary og scaleLines med ukjente mengder", () => {
  const lines = [
    line({ id: "a", quantity: 10, unit: "kg", _rm: { id: "m", name: "Hvetemel", grain_classification: "wheat" } }),
    line({ id: "b", quantity: 2, unit: "l", _rm: { id: "o", name: "Rapsolje" } }),
  ];

  it("gir ikke bekreftet antall emner eller satser når en linje er ukjent", () => {
    const s = scaledSummary(lines, 2, 500, 40, 20000);
    expect(s.incomplete).toBe(true);
    expect(s.unitCount).toBeNull();
    expect(s.totals.unitCount).toBeNull();
    expect(s.batchCount).toBeNull();
  });

  it("beholder beregnbar g/kg-skalering når alt er kjent", () => {
    const known = [
      lines[0],
      line({ id: "c", quantity: 6, unit: "l", _rm: { id: "v", name: "Vann", water_content_pct: 100 } }),
    ];
    const s = scaledSummary(known, 2, 1000, 32, 20000);
    expect(s.incomplete).toBe(false);
    expect(s.exactDoughG).toBe(32000);
    expect(s.unitCount).toBe(32);
    expect(s.batchCount).toBe(2);
  });

  it("ukjent linje blir ikke 0 g, men beholder mengde og enhet", () => {
    const scaled = scaleLines(lines, 2, 10000);
    expect(scaled[0]).toMatchObject({ exact: true, exactGrams: 20000, roundedGrams: 20000 });
    expect(scaled[1].exact).toBe(false);
    expect(scaled[1].scaledQuantity).toBe(4);
    expect(scaled[1].unit).toBe("l");
    expect(scaled[1].percent).toBe(0);
  });
});

// ===== Halvfabrikat: pris per kg må bruke linjeomregningen =====

describe("costPerKg for halvfabrikat", () => {
  it("1 l vann + 1 kg mel gir 2 kg og riktig pris", () => {
    const lines = [
      line({ id: "m", quantity: 1, unit: "kg", _rm: { id: "m", name: "Hvetemel", current_cost_price: 12 } }),
      line({ id: "v", quantity: 1, unit: "l", _rm: { id: "v", name: "Vann", current_cost_price: 0 } }),
    ];
    // 12 kr fordelt på 2 kg deig
    expect(costPerKg(lines)).toBeCloseTo(6, 6);
    expect(costPerKgBlockedReason(lines)).toBeNull();
  });

  it("1 dl olje uten tetthet gir ingen pris per kg", () => {
    const lines = [
      line({ id: "m", quantity: 1, unit: "kg", _rm: { id: "m", name: "Hvetemel", current_cost_price: 12 } }),
      line({ id: "o", quantity: 1, unit: "dl", _rm: { id: "o", name: "Rapsolje", current_cost_price: 30 } }),
    ];
    expect(costPerKg(lines)).toBeNull();
    expect(costPerKgBlockedReason(lines)).toContain("Rapsolje");
  });
});
