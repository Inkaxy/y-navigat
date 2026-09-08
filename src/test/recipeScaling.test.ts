import { describe, expect, it } from "vitest";
import type { BakersLine } from "../varer/lib/bakers";
import { roundToStep, scaleRecipe, type ScaleRequest } from "../varer/lib/scaling";

function line(overrides: Partial<BakersLine>): BakersLine {
  return {
    id: "id",
    recipe_part_id: "part",
    raw_material_id: null,
    quantity: 0,
    unit: "g",
    ...overrides,
  };
}

/** Enkel basisoppskrift: 1000 g mel, 700 g vann, 20 g salt → 1720 g deig. */
function unitsFlourRecipe(): BakersLine[] {
  return [
    line({ id: "flour", quantity: 1000, unit: "g", ingredient_name: "Hvetemel", is_flour_override: true }),
    line({ id: "water", quantity: 700, unit: "g", ingredient_name: "Vann" }),
    line({ id: "salt", quantity: 20, unit: "g", ingredient_name: "Salt" }),
  ];
}

/** Basisoppskrift som deler jevnt i 3 batcher: 1500 g mel, 900 g vann, 30 g salt → 2430 g deig. */
function threeBatchRecipe(): BakersLine[] {
  return [
    line({ id: "flour", quantity: 1500, unit: "g", ingredient_name: "Hvetemel", is_flour_override: true }),
    line({ id: "water", quantity: 900, unit: "g", ingredient_name: "Vann" }),
    line({ id: "salt", quantity: 30, unit: "g", ingredient_name: "Salt" }),
  ];
}

describe("roundToStep", () => {
  it("runder til nærmeste 5 g", () => {
    expect(roundToStep(102, 5)).toBe(100);
    expect(roundToStep(103, 5)).toBe(105);
  });

  it("runder til nærmeste 1 g", () => {
    expect(roundToStep(10.4, 1)).toBe(10);
    expect(roundToStep(10.6, 1)).toBe(11);
  });

  it("runder til 0,1 g uten flyttallsstøy", () => {
    const r = roundToStep(1.44, 0.1);
    expect(r).toBe(1.4);
    // Ingen flyttallsstøy som 1.4000000000000001.
    expect(r.toString()).toBe("1.4");
  });
});

describe("scaleRecipe — modus og faktor", () => {
  const req = (overrides: Partial<ScaleRequest>): ScaleRequest => ({
    mode: "dough",
    target: 0,
    rounding: 1,
    ...overrides,
  });

  it("modus 'units' gir riktig faktor ut fra basisantall emner", () => {
    // dough_piece_grams 430 → basisantall = floor(1720/430) = 4.
    const res = scaleRecipe(
      unitsFlourRecipe(),
      { dough_piece_grams: 430, dough_waste_pct: 0 },
      req({ mode: "units", target: 8 }),
    );
    expect(res.incomplete).toBe(false);
    expect(res.factor).toBeCloseTo(2, 6);
  });

  it("modus 'flour' gir riktig faktor ut fra basismelvekt", () => {
    const res = scaleRecipe(unitsFlourRecipe(), {}, req({ mode: "flour", target: 2000 }));
    expect(res.factor).toBeCloseTo(2, 6);
  });

  it("modus 'dough' gir riktig faktor ut fra basisdeigvekt", () => {
    const res = scaleRecipe(unitsFlourRecipe(), {}, req({ mode: "dough", target: 3440 }));
    expect(res.factor).toBeCloseTo(2, 6);
  });

  it("modus 'batches' gir faktor 1 og riktig antall batcher", () => {
    const res = scaleRecipe(
      threeBatchRecipe(),
      {},
      req({ mode: "batches", target: 0.81, rounding: 1 }),
    );
    expect(res.factor).toBeCloseTo(1, 6);
    expect(res.batchCount).toBe(3);
  });
});

describe("scaleRecipe — 3 batcher og per-batch-tabell", () => {
  it("3 × perBatch tilsvarer totalen", () => {
    const res = scaleRecipe(
      threeBatchRecipe(),
      {},
      { mode: "batches", target: 0.81, rounding: 1 },
    );
    expect(res.batchCount).toBe(3);
    expect(res.batchDoughG * 3).toBeCloseTo(res.totalDoughG, 6);
    expect(res.batchFlourG * 3).toBeCloseTo(res.totalFlourG, 6);

    const flourLine = res.perBatch.find((l) => l.lineId === "flour");
    expect(flourLine?.grams).toBeCloseTo(500, 6);
  });
});

describe("scaleRecipe — svinn", () => {
  it("svinn øker mengdene med (1 + svinn/100)", () => {
    const uten = scaleRecipe(unitsFlourRecipe(), {}, { mode: "dough", target: 1720, rounding: 1 });
    const med = scaleRecipe(
      unitsFlourRecipe(),
      {},
      { mode: "dough", target: 1720, rounding: 1, wastePct: 10 },
    );
    expect(med.factor).toBeCloseTo(uten.factor * 1.1, 6);
    expect(med.totalDoughG).toBeGreaterThan(uten.totalDoughG);
  });
});

describe("scaleRecipe — ukjent omregning", () => {
  it("linje uten kjent gramomregning gir grams: null, advarsel og incomplete", () => {
    const lines = [
      ...unitsFlourRecipe(),
      line({ id: "oil", quantity: 2, unit: "dl", ingredient_name: "Olje" }),
    ];
    const res = scaleRecipe(lines, {}, { mode: "dough", target: 1720, rounding: 1 });
    expect(res.incomplete).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
    const oilLine = res.perBatch.find((l) => l.lineId === "oil");
    expect(oilLine?.grams).toBeNull();
    expect(oilLine?.unit).toBe("dl");
  });
});

describe("scaleRecipe — bakerprosent uendret av skalering", () => {
  it("bakerprosenten er lik uansett faktor", () => {
    const lines = unitsFlourRecipe();
    const uskalert = scaleRecipe(lines, {}, { mode: "dough", target: 1720, rounding: 1 });
    const skalert = scaleRecipe(lines, {}, { mode: "dough", target: 3440, rounding: 1 });

    const flourUskalert = uskalert.perBatch.find((l) => l.lineId === "flour");
    const flourSkalert = skalert.perBatch.find((l) => l.lineId === "flour");
    expect(flourUskalert?.percent).toBeCloseTo(100, 6);
    expect(flourSkalert?.percent).toBeCloseTo(100, 6);

    const saltUskalert = uskalert.perBatch.find((l) => l.lineId === "salt");
    const saltSkalert = skalert.perBatch.find((l) => l.lineId === "salt");
    expect(saltUskalert?.percent).toBeCloseTo(2, 6);
    expect(saltSkalert?.percent).toBeCloseTo(2, 6);
  });
});
