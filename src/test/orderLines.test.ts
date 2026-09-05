import { describe, it, expect } from "vitest";
import {
  calcLineTotals,
  round2,
  shouldRepriceCopiedLine,
  isPriceRisky,
  countRiskyPriceLines,
  MANUAL_PRICE_SOURCE,
} from "@/ordre/lib/orderLines";

describe("round2 / calcLineTotals — avrunding", () => {
  it("runder halve opp", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0)).toBe(0);
    expect(round2(Number.NaN)).toBe(0);
  });

  it("regner subtotal, mva og totalsum i øre", () => {
    const t = calcLineTotals({ quantity: 3, unit_price: 19.9, vat_rate: 15 });
    expect(t.subtotal).toBe(59.7);
    expect(t.vat).toBe(8.96);
    expect(t.total).toBe(68.66);
    expect(t.discount).toBe(0);
  });

  it("trekker rabatt før mva", () => {
    const t = calcLineTotals({ quantity: 2, unit_price: 100, discount_percent: 10, vat_rate: 25 });
    expect(t.subtotal).toBe(180);
    expect(t.discount).toBe(20);
    expect(t.vat).toBe(45);
    expect(t.total).toBe(225);
  });

  it("tåler tekstverdier og tomme felt", () => {
    const t = calcLineTotals({ quantity: "2", unit_price: "10,5" as unknown as string });
    expect(t.subtotal).toBe(0);
    expect(calcLineTotals({ quantity: "4", unit_price: "10.5" }).subtotal).toBe(42);
  });
});

describe("re-prisregel ved kopiering", () => {
  it("re-priser linjer uten manuell overstyring", () => {
    expect(shouldRepriceCopiedLine({ unit_price_source: "price_list" })).toBe(true);
    expect(shouldRepriceCopiedLine({ unit_price_source: null })).toBe(true);
  });

  it("lar manuelt overstyrte priser stå", () => {
    expect(shouldRepriceCopiedLine({ unit_price_source: MANUAL_PRICE_SOURCE })).toBe(false);
  });
});

describe("0-pris-blokk", () => {
  it("flagger linjer uten reell pris", () => {
    expect(isPriceRisky({ hasProduct: true, unit_price: 0 })).toBe(true);
    expect(isPriceRisky({ hasProduct: true, unit_price: 25, is_fallback: true })).toBe(true);
    expect(isPriceRisky({ hasProduct: true, unit_price: 25 })).toBe(false);
    expect(isPriceRisky({ hasProduct: false, unit_price: 0 })).toBe(false);
  });

  it("teller linjene som må bekreftes", () => {
    expect(
      countRiskyPriceLines([
        { hasProduct: true, unit_price: 0 },
        { hasProduct: true, unit_price: 10 },
        { hasProduct: true, unit_price: 10, is_fallback: true },
        { hasProduct: false, unit_price: 0 },
      ]),
    ).toBe(2);
  });
});
