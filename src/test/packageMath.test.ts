import { describe, it, expect } from "vitest";
import { computeBaseUnitsPerPackage } from "@/ravarer/lib/packageMath";

describe("computeBaseUnitsPerPackage", () => {
  it("regner 500 g på en kg-råvare til 0,5 kg", () => {
    const r = computeBaseUnitsPerPackage({ size: "500", unit: "g", count: "1", baseUnit: "kg" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.baseUnits).toBeCloseTo(0.5, 9);
  });

  it("regner 6 × 500 g til 3 kg", () => {
    const r = computeBaseUnitsPerPackage({ size: "500", unit: "g", count: "6", baseUnit: "kg" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.baseUnits).toBeCloseTo(3, 9);
  });

  it("regner 500 ml på en liter-råvare til 0,5 l", () => {
    const r = computeBaseUnitsPerPackage({ size: "500", unit: "ml", count: "", baseUnit: "l" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.baseUnits).toBeCloseTo(0.5, 9);
  });

  it("beholder tallet når enheten allerede er baseenheten", () => {
    const r = computeBaseUnitsPerPackage({ size: "25", unit: "kg", count: "1", baseUnit: "kg" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.baseUnits).toBe(25);
  });

  it("avviser masse mot volum", () => {
    const r = computeBaseUnitsPerPackage({ size: "500", unit: "g", count: "1", baseUnit: "l" });
    expect(r.ok).toBe(false);
  });

  it("avviser ukjent enhet", () => {
    const r = computeBaseUnitsPerPackage({ size: "500", unit: "klump", count: "1", baseUnit: "kg" });
    expect(r.ok).toBe(false);
  });

  it("avviser antall 0, negativt og ugyldig — uten å falle tilbake til 1", () => {
    for (const count of ["0", "-2", "abc"]) {
      const r = computeBaseUnitsPerPackage({ size: "500", unit: "g", count, baseUnit: "kg" });
      expect(r.ok).toBe(false);
    }
  });

  it("avviser ugyldig eller negativ størrelse", () => {
    for (const size of ["", "0", "-1", "x"]) {
      const r = computeBaseUnitsPerPackage({ size, unit: "g", count: "1", baseUnit: "kg" });
      expect(r.ok).toBe(false);
    }
  });

  it("godtar komma som desimalskille", () => {
    const r = computeBaseUnitsPerPackage({ size: "1,5", unit: "kg", count: "2", baseUnit: "kg" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.baseUnits).toBeCloseTo(3, 9);
  });
});
