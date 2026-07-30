import { describe, it, expect } from "vitest";
import {
  calcLine,
  calcTotals,
  effectiveDining,
  effectiveMvaRate,
  effectiveUnitPriceExclMva,
  isFoodItem,
  type CartItem,
} from "@/kiosk/lib/cart";

function item(over: Partial<CartItem> = {}): CartItem {
  return {
    id: "1",
    product_id: "p1",
    product_snapshot: { display_name: "Bolle" } as CartItem["product_snapshot"],
    quantity: 1,
    unit_price_excl_mva: 100,
    unit_price_incl_mva: null,
    base_mva_rate: 15,
    eatin_mva_rate: 25,
    line_discount: 0,
    ...over,
  };
}

describe("mva-sats og serveringsmodus", () => {
  it("bruker cart-default når linja ikke overstyrer", () => {
    expect(effectiveDining(item(), "eatin")).toBe("eatin");
    expect(effectiveMvaRate(item(), "eatin")).toBe(25);
    expect(effectiveMvaRate(item(), "takeaway")).toBe(15);
  });

  it("lar linje-overstyring vinne over cart-default", () => {
    const i = item({ dining_mode_override: "takeaway" });
    expect(effectiveDining(i, "eatin")).toBe("takeaway");
    expect(effectiveMvaRate(i, "eatin")).toBe(15);
  });

  it("holder satsen fast for ikke-matvarer", () => {
    const i = item({ eatin_mva_rate: null, base_mva_rate: 25 });
    expect(isFoodItem(i)).toBe(false);
    expect(effectiveMvaRate(i, "eatin")).toBe(25);
  });
});

describe("mva-inklusive prislister", () => {
  it("beholder brutto fast og endrer bare mva-splitten", () => {
    const i = item({ unit_price_incl_mva: 115, unit_price_excl_mva: 100 });
    const take = calcLine(i, "takeaway");
    const eat = calcLine(i, "eatin");
    expect(take.gross).toBeCloseTo(115, 2);
    expect(eat.gross).toBeCloseTo(115, 2);
    expect(take.net).toBeCloseTo(100, 2);
    expect(eat.net).toBeCloseTo(92, 2); // 115 / 1,25
    expect(eat.vat).toBeCloseTo(23, 2);
  });

  it("regner netto enhetspris ut fra effektiv sats", () => {
    const i = item({ unit_price_incl_mva: 125 });
    expect(effectiveUnitPriceExclMva(i, "eatin")).toBeCloseTo(100, 2);
    expect(effectiveUnitPriceExclMva(item(), "eatin")).toBe(100);
  });
});

describe("calcLine på eks-mva-priser", () => {
  it("regner netto, mva og brutto med rabatt", () => {
    const l = calcLine(item({ quantity: 3, unit_price_excl_mva: 20, line_discount: 10 }), "takeaway");
    expect(l.net).toBeCloseTo(50, 2);
    expect(l.vat).toBeCloseTo(7.5, 2);
    expect(l.gross).toBeCloseTo(57.5, 2);
    expect(l.mva_rate).toBe(15);
  });
});

describe("calcTotals", () => {
  it("summerer og grupperer per mva-sats", () => {
    const t = calcTotals(
      [
        item({ id: "a", quantity: 2, unit_price_excl_mva: 50 }), // 100 @15
        item({ id: "b", eatin_mva_rate: null, base_mva_rate: 25, unit_price_excl_mva: 40 }), // 40 @25
      ],
      "takeaway",
    );
    expect(t.subtotal_excl_mva).toBeCloseTo(140, 2);
    expect(t.total_mva).toBeCloseTo(15 + 10, 2);
    expect(t.total_incl_mva).toBeCloseTo(165, 2);
    expect(t.mva_breakdown.map((b) => b.rate)).toEqual([15, 25]);
    expect(t.mva_breakdown[0].net).toBeCloseTo(100, 2);
    expect(t.mva_breakdown[1].gross).toBeCloseTo(50, 2);
  });

  it("gir nullsummer for tom kurv", () => {
    const t = calcTotals([], "takeaway");
    expect(t.total_incl_mva).toBe(0);
    expect(t.mva_breakdown).toEqual([]);
  });
});
