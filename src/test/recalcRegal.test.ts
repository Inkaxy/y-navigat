import { describe, expect, it } from "vitest";
import { resolveLineCost } from "@/fakturaer/lib/units";

/**
 * Akseptansetest for reberegningen: faktura 136007296 (Lantmännen Cerealia,
 * 24.08.2026). Linjene var registrert til 26–39 øre/kg fordi mengden i sekker
 * ble delt på pakningen én gang for mye.
 */
const LINES = [
  { description: "REGAL HV.MEL BAKERI AKTIV 25KG", quantity: 24, unitPrice: 7.1, totalAmount: 4260, packageSize: 25, expected: 7.1 },
  { description: "REGAL SAMMALT HVETE FIN 25KG", quantity: 12, unitPrice: 6.63, totalAmount: 1989, packageSize: 25, expected: 6.63 },
  { description: "REGAL HAVREGRYN LETTE 20KG", quantity: 24, unitPrice: 7.73, totalAmount: 3710.4, packageSize: 20, expected: 7.73 },
  { description: "REGAL HVETE HELKORN 25KG", quantity: 48, unitPrice: 6.49, totalAmount: 7788, packageSize: 25, expected: 6.49 },
];

describe("reberegning av faktura 136007296", () => {
  for (const l of LINES) {
    it(`${l.description} gir ${l.expected} kr/kg`, () => {
      const r = resolveLineCost({
        quantity: l.quantity,
        unit: "stk",
        unitPrice: l.unitPrice,
        totalAmount: l.totalAmount,
        packageSize: l.packageSize,
        packageUnit: "kg",
        description: l.description,
        baseUnit: "kg",
      });
      expect(r.needsInput).toBeNull();
      expect(r.basis).toBe("pakning");
      expect(r.baseQuantity).toBeCloseTo(l.quantity * l.packageSize, 4);
      expect(r.pricePerBaseUnit).toBeCloseTo(l.expected, 4);
      expect(r.confidenceLevel).toBe("high");
    });
  }
});
