import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeUnit, parseDecimal, resolveLineCost, deriveLinePackage } from "@/fakturaer/lib/units";

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

  it("historikken velger riktig av to gyldige tolkninger", () => {
    // Begge kandidatene finnes: enheten er kg (fakturaenhet) OG beskrivelsen gir 25 kg/pakning.
    // A = 753,50 / 2 kg = 376,75 kr/kg. B = 753,50 / 50 kg = 15,07 kr/kg.
    // Historikken ligger på ~15 kr/kg, så B skal vinne.
    const r = resolveLineCost({
      quantity: 2,
      unit: "kg",
      unitPrice: 376.75,
      totalAmount: 753.5,
      description: "RUGMEL 25KG",
      baseUnit: "kg",
      knownPricePerBaseUnit: 15.1,
    });
    expect(r.basis).toBe("pakning");
    expect(r.pricePerBaseUnit).toBeCloseTo(15.07, 2);
    expect(r.checks.matchesHistory).toBe(true);
    expect(r.checks.historyOffByPackage).toBe(true);
    expect(r.explanation).toContain("Historikken");
  });

  it("swapNote settes når regnestykket er per baseenhet", () => {
    // 2 stk à 25 kg, enhetsprisen er per kg: 2 × 25 × 15,07 = 753,50.
    const r = resolveLineCost({
      quantity: 2,
      unit: "stk",
      unitPrice: 15.07,
      totalAmount: 753.5,
      description: "RUGMEL 25KG",
      baseUnit: "kg",
    });
    expect(r.checks.arithmeticPerBaseUnit).toBe(true);
    expect(r.checks.arithmeticPerInvoiceUnit).toBe(false);
    expect(r.basis).toBe("pakning");
  });

  it("manglende beløp gir needsInput: amount", () => {
    const r = resolveLineCost({
      quantity: 10,
      unit: "kg",
      unitPrice: null,
      totalAmount: null,
      baseUnit: "kg",
    });
    expect(r.needsInput).toBe("amount");
    expect(r.pricePerBaseUnit).toBe(0);
  });

  it("kreditnota gir negativ kostpris og forstyrrer ikke historikk-kontrollen", () => {
    const r = resolveLineCost({
      quantity: 600,
      unit: "KG",
      unitPrice: -20.18,
      totalAmount: -12107.49,
      description: "HVETEMEL SIKTET 25KG",
      baseUnit: "kg",
      knownPricePerBaseUnit: 20.18,
    });
    expect(r.needsInput).toBeNull();
    expect(r.pricePerBaseUnit).toBeCloseTo(-20.18, 2);
    expect(r.checks.arithmeticPerInvoiceUnit).toBe(true);
    expect(r.checks.matchesHistory).toBe(false);
  });

  it("parseDecimal takler komma, punktum og tomt felt", () => {
    expect(parseDecimal("3,24")).toBeCloseTo(3.24, 4);
    expect(parseDecimal("3.24")).toBeCloseTo(3.24, 4);
    expect(parseDecimal("1 000,5")).toBeCloseTo(1000.5, 4);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("  ")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal(12)).toBe(12);
    expect(parseDecimal(null)).toBeNull();
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

describe("package_size = 1-fellen", () => {
  it("ubekreftet 1 sekk forkastes — beskrivelsen gir 25 kg", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 789.5,
      totalAmount: 789.5,
      description: "DEMERARA SUKKER 25KG",
      baseUnit: "kg",
      supplierPackage: { packageSize: 1, packageUnit: "sekk" },
    });
    expect(r.baseUnitsPerPackage).toBe(25);
    expect(r.baseQuantity).toBe(25);
    expect(r.pricePerBaseUnit).toBeCloseTo(31.58, 2);
  });

  it("bekreftet pakning overstyrer alt — 1 sekk er da virkelig 1 kg", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 789.5,
      totalAmount: 789.5,
      description: "DEMERARA SUKKER 25KG",
      baseUnit: "kg",
      supplierPackage: { packageSize: 1, packageUnit: "sekk", packageConfirmedAt: "2026-01-01T00:00:00Z" },
    });
    expect(r.baseUnitsPerPackage).toBe(1);
    expect(r.pricePerBaseUnit).toBeCloseTo(789.5, 2);
  });

  it("ubekreftet 1 kg mot «REGAL RUGMEL 25KG» — varenavnet vinner", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 379,
      totalAmount: 379,
      description: "REGAL RUGMEL 25KG",
      baseUnit: "kg",
      supplierPackage: { packageSize: 1, packageUnit: "kg" },
    });
    expect(r.baseUnitsPerPackage).toBe(25);
    expect(r.pricePerBaseUnit).toBeCloseTo(15.16, 2);
    expect(r.confidenceLevel).not.toBe("high");
    expect(r.explanation).toContain("men varenavnet sier");
    expect(r.reason).toContain("Bekreft pakningen");
  });

  it("ubekreftet «1 pose» forkastes — pose er en pakke-enhet", () => {
    expect(normalizeUnit("pose")).toBe("sekk");
    const r = resolveLineCost({
      quantity: 1,
      unit: "pose",
      unitPrice: 250,
      totalAmount: 250,
      description: "SOLSIKKEKJERNER 10KG",
      baseUnit: "kg",
      supplierPackage: { packageSize: 1, packageUnit: "pose" },
    });
    expect(r.baseUnitsPerPackage).toBe(10);
    expect(r.pricePerBaseUnit).toBeCloseTo(25, 2);
  });

  it("ubekreftet base_units_per_package slipper ikke inn bakveien ved bogus 1", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 789.5,
      totalAmount: 789.5,
      description: "DEMERARA SUKKER 25KG",
      baseUnit: "kg",
      supplierPackage: { packageSize: 1, packageUnit: "sekk", baseUnitsPerPackage: 1 },
    });
    expect(r.baseUnitsPerPackage).toBe(25);
    expect(r.pricePerBaseUnit).toBeCloseTo(31.58, 2);
  });
});



describe("units.ts-speilet", () => {
  it("frontend-speilet er identisk med edge-versjonen", () => {
    const front = readFileSync("src/fakturaer/lib/units.ts", "utf8").split("\n");
    const shared = readFileSync("supabase/functions/_shared/units.ts", "utf8");
    // De to første linjene i speilet er en henvisning til kilden.
    expect(front.slice(2).join("\n")).toBe(shared);
  });
});
