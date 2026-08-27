import { describe, expect, it } from "vitest";
import { normalizeUnit, resolveLineCost, deriveLinePackage } from "@/fakturaer/lib/units";

describe("resolveLineCost", () => {
  it("Norgesmøllene: 600 kg à 20,18 kr — pakningen skal ikke brukes", () => {
    const r = resolveLineCost({
      quantity: 600,
      unit: "KG",
      unitPrice: 20.18,
      totalAmount: 12107.49,
      description: "HVETEMEL SIKTET 25KG",
      baseUnit: "kg",
    });
    expect(r.needsInput).toBeNull();
    expect(r.basis).toBe("fakturaenhet");
    expect(r.baseQuantity).toBe(600);
    expect(r.pricePerBaseUnit).toBeCloseTo(20.18, 2);
    expect(r.checks.arithmeticPerInvoiceUnit).toBe(true);
    expect(r.confidenceLevel).toBe("high");
    expect(r.explanation).toContain("kr/kg");
  });

  it("Regal: 2 stk à 25 kg, pris per kg", () => {
    const r = resolveLineCost({
      quantity: 2,
      unit: "stk",
      unitPrice: 15.07,
      totalAmount: 753.5,
      description: "REGAL STEINMALT RUGMEL 25KG",
      baseUnit: "kg",
    });
    expect(r.basis).toBe("pakning");
    expect(r.baseQuantity).toBe(50);
    expect(r.pricePerBaseUnit).toBeCloseTo(15.07, 2);
    expect(r.checks.arithmeticPerBaseUnit).toBe(true);
  });

  it("Demerara: 1 sekk der enhetsprisen er per kg", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 31.58,
      totalAmount: 789.5,
      description: "DEMERARA SUKKER 25KG",
      baseUnit: "kg",
    });
    expect(r.basis).toBe("pakning");
    expect(r.baseQuantity).toBe(25);
    expect(r.pricePerBaseUnit).toBeCloseTo(31.58, 2);
  });

  it("Demerara: 1 sekk der enhetsprisen er per sekk — samme kostpris", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 738.75,
      totalAmount: 738.75,
      description: "DEMERARA SUKKER 25KG",
      baseUnit: "kg",
    });
    expect(r.basis).toBe("pakning");
    expect(r.pricePerBaseUnit).toBeCloseTo(29.55, 2);
  });

  it("36X90G-eske gir 3,24 kg per eske", () => {
    const r = resolveLineCost({
      quantity: 2,
      unit: "eske",
      unitPrice: 500,
      totalAmount: 1000,
      description: "ALI ORIGINAL FINMALT 36X90G",
      baseUnit: "kg",
    });
    expect(r.baseUnitsPerPackage).toBeCloseTo(3.24, 4);
    expect(r.baseQuantity).toBeCloseTo(6.48, 4);
    expect(r.pricePerBaseUnit).toBeCloseTo(1000 / 6.48, 4);
  });

  it("gram mot basisenhet kg regnes om direkte", () => {
    const r = resolveLineCost({
      quantity: 5000,
      unit: "g",
      unitPrice: 0.05,
      totalAmount: 250,
      baseUnit: "kg",
    });
    expect(r.basis).toBe("fakturaenhet");
    expect(r.baseQuantity).toBe(5);
    expect(r.pricePerBaseUnit).toBeCloseTo(50, 4);
  });

  it("pakke-enhet uten kjent innhold gir needsInput", () => {
    const r = resolveLineCost({
      quantity: 4,
      unit: "sekk",
      unitPrice: 450,
      totalAmount: 1800,
      description: "SPESIALBLANDING",
      baseUnit: "kg",
    });
    expect(r.needsInput).toBe("package_size");
    expect(r.reason).toContain("sekk");
  });

  it("historikken avslører feil kandidat", () => {
    // Prisen er oppgitt per sekk, men enheten sier kg. Historikken sier ~15 kr/kg.
    const r = resolveLineCost({
      quantity: 2,
      unit: "stk",
      unitPrice: 376.75,
      totalAmount: 753.5,
      description: "RUGMEL 25KG",
      baseUnit: "kg",
      knownPricePerBaseUnit: 15.1,
    });
    expect(r.pricePerBaseUnit).toBeCloseTo(15.07, 2);
    expect(r.checks.matchesHistory).toBe(true);
  });

  it("deriveLinePackage ganger med count_per_package", () => {
    const p = deriveLinePackage({ package_size: 90, package_unit: "g", count_per_package: 36 });
    expect(p).toEqual({ size: 3240, unit: "g", source: "line" });
  });

  it("nye enhetsaliaser er kjent", () => {
    expect(normalizeUnit("palleboks")).toBe("palleboks");
    expect(normalizeUnit("container")).toBe("konteiner");
    expect(normalizeUnit("KRG")).toBe("eske");
    expect(normalizeUnit("bulk")).toBe("bulk");
  });
});
