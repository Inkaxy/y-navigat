import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeUnit,
  parseDecimal,
  resolveLineCost,
  deriveLinePackage,
  parsePackageFromDescription,
  stripPackageTokens,
} from "@/fakturaer/lib/units";

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

  it("bekreftet «1 sekk» uten innhold gir ingen pris — mennesket må fylle inn", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 789.5,
      totalAmount: 789.5,
      description: "DEMERARA SUKKER 25KG",
      baseUnit: "kg",
      supplierPackage: { packageSize: 1, packageUnit: "sekk", packageConfirmedAt: "2026-01-01T00:00:00Z" },
    });
    expect(r.needsInput).toBe("package_size");
    expect(r.reason).toContain("innhold per pakning");
  });

  it("bekreftet innhold per pakning brukes som sannhet", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 789.5,
      totalAmount: 789.5,
      description: "DEMERARA SUKKER 25KG",
      baseUnit: "kg",
      supplierPackage: {
        packageSize: 1,
        packageUnit: "sekk",
        baseUnitsPerPackage: 25,
        packageConfirmedAt: "2026-01-01T00:00:00Z",
      },
    });
    expect(r.baseUnitsPerPackage).toBe(25);
    expect(r.pricePerBaseUnit).toBeCloseTo(31.58, 2);
  });

  it("ubekreftet 1 kg mot «REGAL RUGMEL 25KG» — uenighet krever menneske", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "sekk",
      unitPrice: 379,
      totalAmount: 379,
      description: "REGAL RUGMEL 25KG",
      baseUnit: "kg",
      supplierPackage: { packageSize: 1, packageUnit: "kg" },
    });
    expect(r.needsInput).toBe("package_size");
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



describe("delte filer mot _shared", () => {
  it("units.ts er byte-identisk med edge-versjonen", () => {
    const front = readFileSync("src/fakturaer/lib/units.ts", "utf8");
    const shared = readFileSync("supabase/functions/_shared/units.ts", "utf8");
    expect(front).toBe(shared);
  });

  it("matchNormalize.ts er byte-identisk med edge-versjonen", () => {
    const front = readFileSync("src/fakturaer/lib/matchNormalize.ts", "utf8");
    const shared = readFileSync("supabase/functions/_shared/matchNormalize.ts", "utf8");
    expect(front).toBe(shared);
  });
});

describe("pakningsparser", () => {
  it("«N x SIZE» gir antall og størrelse", () => {
    expect(parsePackageFromDescription("HVETEMEL 36X90G")).toMatchObject({ size: 90, unit: "g", count: 36 });
  });

  it("«SIZE x N» leses riktig vei — 1kg x 10", () => {
    expect(parsePackageFromDescription("MELIS 1kg x 10")).toMatchObject({ size: 1, unit: "kg", count: 10 });
  });

  it("«500G X 12» gir 500 g × 12", () => {
    expect(parsePackageFromDescription("SMØR 500G X 12")).toMatchObject({ size: 500, unit: "g", count: 12 });
  });

  it("brøk i multiplikasjon: «6 x 1/2 kg»", () => {
    expect(parsePackageFromDescription("GJÆR 6 x 1/2 kg")).toMatchObject({ size: 0.5, unit: "kg", count: 6 });
  });

  it("brøk alene: «1/2 kg»", () => {
    expect(parsePackageFromDescription("GJÆR 1/2 kg")).toMatchObject({ size: 0.5, unit: "kg", count: 1 });
  });

  it("stk-antall fanges: «10 stk x 500 g»", () => {
    expect(parsePackageFromDescription("BOLLE 10 stk x 500 g")).toMatchObject({ size: 500, unit: "g", count: 10 });
  });

  it("velger den pakningsdefinerende størrelsen, ikke den siste", () => {
    expect(parsePackageFromDescription("OST 10 KG EMB 500 G")).toMatchObject({ size: 10, unit: "kg", count: 1 });
  });

  it("norsk tusenskille: «1.000 kg» er 1000 kg", () => {
    expect(parsePackageFromDescription("SALT 1.000 KG")).toMatchObject({ size: 1000, unit: "kg" });
  });

  it("desimaltall med komma tolkes som desimal", () => {
    expect(parsePackageFromDescription("FLØTE 0,5 L")).toMatchObject({ size: 0.5, unit: "l" });
  });

  it("pakningsord fjernes fra navnet", () => {
    expect(stripPackageTokens("HVETEMEL SIKTET 10X1KG KRT")).toBe("hvetemel siktet");
    expect(stripPackageTokens("DEMERARA SUKKER 25KG SEKK")).toBe("demerara sukker");
  });
});

describe("kartong med stk-antall", () => {
  it("basisenhet stk: pris per stk = beløp ÷ (kartonger × antall i kartong)", () => {
    const r = resolveLineCost({
      quantity: 2,
      unit: "eske",
      totalAmount: 400,
      packageSize: 1,
      packageUnit: "kg",
      countPerPackage: 10,
      description: "RUNDSTYKKE 10 x 1 kg",
      baseUnit: "stk",
    });
    expect(r.needsInput).toBeNull();
    expect(r.baseQuantity).toBe(20);
    expect(r.pricePerBaseUnit).toBeCloseTo(20, 6);
  });

  it("basisenhet kg: 2 KRT à 10 x 1 kg gir 20 kg", () => {
    const r = resolveLineCost({
      quantity: 2,
      unit: "eske",
      totalAmount: 400,
      description: "HVETEMEL 2 KRT à 10 x 1 kg",
      baseUnit: "kg",
    });
    expect(r.needsInput).toBeNull();
    expect(r.baseQuantity).toBe(20);
    expect(r.pricePerBaseUnit).toBeCloseTo(20, 6);
  });

  it("stk-antall fra beskrivelsen brukes når basisenheten er stk", () => {
    const r = resolveLineCost({
      quantity: 1,
      unit: "eske",
      totalAmount: 120,
      description: "KAKESTYKKE 12 x 100 g",
      baseUnit: "stk",
    });
    expect(r.baseQuantity).toBe(12);
    expect(r.pricePerBaseUnit).toBeCloseTo(10, 6);
  });
});
