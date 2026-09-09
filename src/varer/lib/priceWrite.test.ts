import { describe, it, expect } from "vitest";
import { previousDay, requiredPriceForTarget, marginPct } from "./priceWrite";

describe("previousDay", () => {
  it("går over månedsskifte", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });
});

describe("requiredPriceForTarget", () => {
  it("regner nødvendig pris fra kost og DG2-mål", () => {
    expect(requiredPriceForTarget(10, 50)).toBe(20);
    expect(requiredPriceForTarget(7.5, 40)).toBe(12.5);
  });

  it("returnerer null ved umulige eller manglende verdier", () => {
    expect(requiredPriceForTarget(10, 100)).toBeNull();
    expect(requiredPriceForTarget(null, 50)).toBeNull();
    expect(requiredPriceForTarget(10, null)).toBeNull();
  });
});

describe("marginPct", () => {
  it("regner DG2 i prosent av salgspris", () => {
    expect(marginPct(20, 10)).toBe(50);
    expect(marginPct(12.5, 7.5)).toBe(40);
  });

  it("returnerer null når prisen mangler eller er null", () => {
    expect(marginPct(0, 10)).toBeNull();
    expect(marginPct(null, 10)).toBeNull();
  });
});
