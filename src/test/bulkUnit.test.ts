import { describe, expect, it } from "vitest";
import { unitCorrectionOptions, unitCorrectionState } from "@/fakturaer/lib/unitCorrection";
import { resolveLineCost, CANONICAL_BASE_UNITS, CANONICAL_PACKAGE_UNITS } from "@/fakturaer/lib/units";

describe("bulk i «Rett fakturert enhet»", () => {
  it("nedtrekket inneholder bulk, kg og alle felles kanoniske enheter", () => {
    const opts = unitCorrectionOptions("sekk");
    expect(opts).toContain("bulk");
    expect(opts).toContain("kg");
    expect(opts).toContain("pose");
    for (const u of [...CANONICAL_BASE_UNITS, ...CANONICAL_PACKAGE_UNITS]) if (u !== "sekk") expect(opts).toContain(u);
    expect(unitCorrectionOptions("bulk")).not.toContain("bulk");
  });
  it("retting til bulk sender bare enheten (styrt vei, begrunnelse kreves)", () => {
    const base = { before: "sekk", after: "bulk", costPosted: false, loading: false, loadError: false, unknown: false };
    expect(unitCorrectionState({ ...base, reason: "" }).kind).toBe("blocked");
    expect(unitCorrectionState({ ...base, reason: "Silolevering" })).toEqual({ kind: "ready", after: "bulk" });
    expect(unitCorrectionState({ ...base, reason: "Silolevering", costPosted: true }).kind).toBe("blocked");
  });
});

describe("bulklevering med varierende levert kg", () => {
  it("levert kg × pris per kg gir kost uten fast pakning eller leverandørbekreftelse", () => {
    for (const kg of [23840, 27115.5]) {
      const r = resolveLineCost({ quantity: kg, unit: "kg", unitPrice: 6.2, totalAmount: kg * 6.2, baseUnit: "kg", description: "Hvetemel bulk silo" });
      expect(r.costPerBaseUnit).toBeCloseTo(6.2, 4);
      expect(r.basis).not.toBe("pakning");
    }
  });
  it("tvetydig bulk uten kg-grunnlag gir ingen gjettet kapasitet", () => {
    const r = resolveLineCost({ quantity: 1, unit: "bulk", unitPrice: 150000, totalAmount: 150000, baseUnit: "kg", description: "Hvetemel bulk" });
    expect(r.costPerBaseUnit ?? null).toBeNull();
    expect(r.reason ?? "").not.toBe("");
  });
});
