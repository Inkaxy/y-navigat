import { describe, it, expect } from "vitest";
import {
  aggregateProductionLines,
  type AggregateLine,
  type AggregateProduct,
} from "@/produksjon/features/produksjonsplan/lib/aggregate";
import { productionRowKey } from "@/produksjon/features/produksjonsplan/hooks/useProductionPlanSnapshots";
import { DEFAULT_CRITERIA } from "@/produksjon/features/produksjonsplan/types";

function product(id: string): AggregateProduct {
  return {
    id,
    display_number: null,
    display_name: `Vare ${id}`,
    unit_of_sale: "stk",
    main_category_id: null,
    sub_category_id: null,
    production_group_id: null,
    dough_type: null,
    pieces_per_tray: null,
    pieces_per_liter: null,
  };
}

function line(tour: number | null, productId: string, quantity: number): AggregateLine {
  const p = product(productId);
  return {
    tour,
    product: p,
    originalProduct: p,
    quantity,
    customerId: null,
    source: "bestilling",
  };
}

const lines: AggregateLine[] = [
  line(1, "p1", 3),
  line(1, "p1", 4),
  line(2, "p1", 5),
  line(1, "p2", 2),
  line(null, "p1", 6),
];

function sums(sumTours: boolean): Record<string, number> {
  const rows = aggregateProductionLines(lines, { sum_tours: sumTours });
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[productionRowKey(r.tour_number, r.product_id, { sum_tours: sumTours })] =
      r.quantity_ordered;
  }
  return out;
}

describe("aggregateProductionLines", () => {
  it("legger sammen samme produkt på samme tur", () => {
    const s = sums(false);
    expect(s["t1::p:p1"]).toBe(7);
    expect(s["t2::p:p1"]).toBe(5);
    expect(s["t1::p:p2"]).toBe(2);
  });

  it("holder «uten tur» adskilt fra turene", () => {
    const s = sums(false);
    expect(s["tx::p:p1"]).toBe(6);
    expect(Object.keys(s)).toHaveLength(4);
  });

  it("slår sammen alle turer per produkt når sum_tours er på", () => {
    const s = sums(true);
    expect(s["ALL::p:p1"]).toBe(18);
    expect(s["ALL::p:p2"]).toBe(2);
    expect(Object.keys(s)).toHaveLength(2);
  });

  it("samler detaljer per kunde og sorterer på tur og kundenummer", () => {
    const p = product("p1");
    const rows = aggregateProductionLines(
      [
        { tour: 2, product: p, originalProduct: p, quantity: 1, customerId: "c2", source: "bestilling" },
        { tour: 1, product: p, originalProduct: p, quantity: 2, customerId: "c1", source: "pakkseddel" },
      ],
      { sum_tours: true },
      {
        customer: (id) => ({ number: id === "c1" ? "100" : "200", name: `Kunde ${id}`, address: null }),
        tourName: (t) => `Tur ${t}`,
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity_ordered).toBe(3);
    expect(rows[0].details.map((d) => d.customer_id)).toEqual(["c1", "c2"]);
    expect(rows[0].details[0].tour_name).toBe("Tur 1");
    expect(rows[0].sources).toContain("pakkseddel");
  });

  it("standardkriteriene summerer turer", () => {
    expect(DEFAULT_CRITERIA.sum_tours).toBe(true);
    expect(productionRowKey(3, "p9", DEFAULT_CRITERIA)).toBe("ALL::p:p9");
    expect(productionRowKey(3, "p9", { sum_tours: false })).toBe("t3::p:p9");
  });
});
