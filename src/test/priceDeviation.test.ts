import { describe, expect, it } from "vitest";
import { evaluatePriceDeviation } from "@/fakturaer/lib/priceDeviation";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";

const base = { tolPct: 3, minImpactNok: 50, hardCapPct: 15 };

describe("nivådelt prisavvik", () => {
  it("innenfor toleranse", () => {
    const r = evaluatePriceDeviation({ ...base, actual: 102, expected: 100, baseQuantity: 100 });
    expect(r.rule).toBe("innenfor_toleranse");
    expect(r.large).toBe(false);
  });
  it("over toleranse men liten kronevirkning godtas", () => {
    const r = evaluatePriceDeviation({ ...base, actual: 10.42, expected: 10, baseQuantity: 43 });
    expect(r.rule).toBe("liten_kronevirkning");
    expect(r.large).toBe(false);
    expect(r.explanation).toContain("godtas automatisk");
    expect(r.explanation).toContain("18 kr");
  });
  it("over toleranse og over minstebeløp er stort", () => {
    const r = evaluatePriceDeviation({ ...base, actual: 10.42, expected: 10, baseQuantity: 286 });
    expect(r.rule).toBe("over_toleranse");
    expect(r.large).toBe(true);
    expect(r.explanation).toBe("+4,2 % (120 kr på denne linjen) — over toleransen på 3 % og over minstebeløpet på 50 kr");
  });
  it("over maksgrense er alltid stort", () => {
    const r = evaluatePriceDeviation({ ...base, actual: 120, expected: 100, baseQuantity: 0.1 });
    expect(r.rule).toBe("over_maksgrense");
    expect(r.large).toBe(true);
  });
  it("uten mengde teller bare prosenten", () => {
    const r = evaluatePriceDeviation({ ...base, actual: 105, expected: 100, baseQuantity: null });
    expect(r.rule).toBe("over_toleranse");
    expect(r.impactNok).toBeNull();
  });
  it("mengde 0 gir kjent kronevirkning 0", () => {
    const r = evaluatePriceDeviation({ ...base, actual: 105, expected: 100, baseQuantity: 0 });
    expect(r.impactNok).toBe(0);
    expect(r.rule).toBe("liten_kronevirkning");
  });
  it("avrunder som databasen", () => {
    const r = evaluatePriceDeviation({ ...base, actual: 10.4237, expected: 10, baseQuantity: 3.333 });
    expect(r.pct).toBe(4.237);
    expect(r.impactNok).toBe(1.41);
  });
  it("mangler grunnlag", () => {
    expect(evaluatePriceDeviation({ ...base, actual: 5, expected: null, baseQuantity: 1 }).rule).toBe("mangler_grunnlag");
    expect(evaluatePriceDeviation({ ...base, actual: 5, expected: 0, baseQuantity: 1 }).rule).toBe("mangler_grunnlag");
  });
});

describe("supplierItemKey", () => {
  it("bruker normalisert varenummer", () => {
    expect(supplierItemKey({ supplier_sku: " AB-12.3 ", description: "x" })).toBe("sku:ab123");
  });
  it("faller tilbake på normalisert navn", () => {
    expect(supplierItemKey({ supplier_sku: "", description: "Hvetemel, Siktet 25KG" })).toBe("name:hvetemel siktet 25kg");
  });
  it("gir null uten identitet", () => {
    expect(supplierItemKey({ supplier_sku: null, description: "  " })).toBeNull();
  });
});
