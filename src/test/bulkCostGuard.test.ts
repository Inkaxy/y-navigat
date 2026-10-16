import { describe, it, expect } from "vitest";
import { resolveLineCost, normalizeUnit } from "@/fakturaer/lib/units";
const conf = { packageSize: 25, packageUnit: "kg", baseUnitsPerPackage: 25, packageConfirmedAt: "2026-01-01" };
const base = { baseUnit: "kg", supplierPackage: conf, rawMaterialPackage: { ...conf } } as const;
describe("bulk arver aldri sekkevekt", () => {
  it("bulk er ikke alias for kg", () => expect(normalizeUnit("bulk")).toBe("bulk"));
  for (const qty of [1, 3470]) {
    it(`bulk qty ${qty} med bekreftet SEKK25 stopper`, () => {
      const r = resolveLineCost({ ...base, unit: "bulk", quantity: qty, unitPrice: 5.84, totalAmount: qty * 5.84, description: "Hvetemel Activ Bulk 25 kg" } as never);
      expect(r.needsInput).toBe("package_size");
      expect(JSON.stringify(r)).toContain("Oppgi faktisk levert kg");
    });
  }
  it("eksplisitt kg beholder identitet", () => {
    const r = resolveLineCost({ ...base, unit: "kg", quantity: 23840, unitPrice: 5.84, totalAmount: 23840 * 5.84 } as never);
    expect(r.pricePerBaseUnit).toBeCloseTo(5.84, 4);
  });
  it("bulk med linjens egen dokumenterte kg brukes", () => {
    const r = resolveLineCost({ ...base, unit: "bulk", quantity: 1, packageSize: 23840, packageUnit: "kg", totalAmount: 23840 * 5.84 } as never);
    expect(r.pricePerBaseUnit).toBeCloseTo(5.84, 4);
    expect(r.baseQuantity).toBe(23840);
  });
});
