import { describe, it, expect } from "vitest";
import { productionRowKey } from "@/produksjon/features/produksjonsplan/hooks/useProductionPlanSnapshots";
import { DEFAULT_CRITERIA } from "@/produksjon/features/produksjonsplan/types";

type Line = { tour: number | null; product_id: string; quantity: number };

/**
 * Speiler aggregeringen i useProductionPlan: alle linjer med samme rad-nøkkel
 * (`productionRowKey`) legges sammen på antall.
 */
function sumByRowKey(lines: Line[], sumTours: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    const key = productionRowKey(sumTours ? null : l.tour, l.product_id, { sum_tours: sumTours });
    out[key] = (out[key] ?? 0) + l.quantity;
  }
  return out;
}

describe("summering per product_id i produksjonsplanen", () => {
  const lines: Line[] = [
    { tour: 1, product_id: "p1", quantity: 3 },
    { tour: 1, product_id: "p1", quantity: 4 },
    { tour: 2, product_id: "p1", quantity: 5 },
    { tour: 1, product_id: "p2", quantity: 2 },
    { tour: null, product_id: "p1", quantity: 6 },
  ];

  it("legger sammen samme produkt på samme tur", () => {
    const sums = sumByRowKey(lines, false);
    expect(sums["t1::p:p1"]).toBe(7);
    expect(sums["t2::p:p1"]).toBe(5);
    expect(sums["t1::p:p2"]).toBe(2);
  });

  it("holder «uten tur» adskilt fra turene", () => {
    const sums = sumByRowKey(lines, false);
    expect(sums["tx::p:p1"]).toBe(6);
    expect(Object.keys(sums)).toHaveLength(4);
  });

  it("slår sammen alle turer per produkt når sum_tours er på", () => {
    const sums = sumByRowKey(lines, true);
    expect(sums["ALL::p:p1"]).toBe(18);
    expect(sums["ALL::p:p2"]).toBe(2);
    expect(Object.keys(sums)).toHaveLength(2);
  });

  it("standardkriteriene summerer turer", () => {
    expect(DEFAULT_CRITERIA.sum_tours).toBe(true);
    expect(productionRowKey(3, "p9", DEFAULT_CRITERIA)).toBe("ALL::p:p9");
    expect(productionRowKey(3, "p9", { sum_tours: false })).toBe("t3::p:p9");
  });
});
