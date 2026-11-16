import { describe, expect, it } from "vitest";
import { documentationText, factorChanges, marginFigures, neededPrice, parsePeriod, periodStart, productDrivers, qtyInBaseUnit } from "./prisgrunnlag";

describe("prisgrunnlag: periode", () => {
  it("standard er 12 måneder, og «alt» har ingen nedre grense", () => {
    expect(parsePeriod(null)).toBe(12);
    expect(periodStart("2026-11-16", 12)).toBe("2025-11-16");
    expect(periodStart("2026-11-16", "alt")).toBeNull();
  });
  it("månedsslutt klemmes", () => {
    expect(periodStart("2026-05-31", 3)).toBe("2026-02-28");
  });
});

describe("prisgrunnlag: innsatsfaktorer", () => {
  const mel = { id: "mel", name: "Hvetemel", baseUnit: "kg", usableCost: 9.6 };
  it("sammenligner med siste pris før perioden i samme dokumenterte enhet", () => {
    const { changes } = factorChanges([mel], [
      { rawMaterialId: "mel", price: 8, date: "2025-06-01", unit: "kg", currency: "NOK" },
      { rawMaterialId: "mel", price: 8.5, date: "2026-01-01", unit: "kg", currency: null },
    ], "2025-11-16");
    expect(changes[0]).toMatchObject({ thenPrice: 8, changePct: 20, firstInPeriod: false });
  });
  it("udokumentert eller annen enhet er ukjent, aldri tolket med dagens enhet", () => {
    const r = factorChanges([mel], [{ rawMaterialId: "mel", price: 200, date: "2026-01-01", unit: null, currency: "NOK" }], "2025-11-16");
    expect(r.changes).toHaveLength(0);
    expect(r.unknown).toBe(1);
    const s = factorChanges([mel], [{ rawMaterialId: "mel", price: 200, date: "2026-01-01", unit: "sekk", currency: "NOK" }], "2025-11-16");
    expect(s.unknown).toBe(1);
  });
  it("uten pris før perioden brukes første pris i perioden", () => {
    const { changes } = factorChanges([mel], [{ rawMaterialId: "mel", price: 9.6 * 0.8, date: "2026-03-01", unit: "kg", currency: "NOK" }], "2025-11-16");
    expect(changes[0].firstInPeriod).toBe(true);
  });
  it("råvarer uten verifisert kost er ukjent", () => {
    const r = factorChanges([{ ...mel, usableCost: null }], [{ rawMaterialId: "mel", price: 8, date: "2026-01-01", unit: "kg", currency: "NOK" }], "2025-11-16");
    expect(r).toEqual({ changes: [], unknown: 1 });
  });
});

describe("prisgrunnlag: Brutto og DG2", () => {
  const c = { raw: 30, labor: 20, energy: 0, pack: 10 };
  it("emballasje teller i både Brutto og DG2 når innstillingen er på", () => {
    expect(marginFigures(100, c, true)).toMatchObject({ bruttoPct: 60, dg2Pct: 40, varekost: 40, selvkost: 60 });
  });
  it("innstillingen av gir dagens regel", () => {
    expect(marginFigures(100, c, false)).toMatchObject({ bruttoPct: 70, dg2Pct: 50 });
  });
  it("nødvendig pris holder begge mål", () => {
    expect(neededPrice(c, true, 60, 40)).toBe(100);
    expect(neededPrice(c, false, 60, 40)).toBe(83.33);
  });
  it("uten pris er margin ukjent", () => {
    expect(marginFigures(null, c, true).bruttoPct).toBeNull();
  });
});

describe("prisgrunnlag: drivere per vare", () => {
  const ch = new Map([["mel", { rawMaterialId: "mel", name: "Hvetemel", baseUnit: "kg", thenPrice: 8, thenDate: "2025-06-01", nowPrice: 10, changePct: 25, firstInPeriod: false }]]);
  it("mengde i grunnenhet fra gram, aldri gjettet for stk", () => {
    expect(qtyInBaseUnit({ rawMaterialId: "mel", quantity: null, unit: null, quantityGrams: 5000, wastePct: null }, "kg")).toBe(5);
    expect(qtyInBaseUnit({ rawMaterialId: "egg", quantity: 10, unit: "stk", quantityGrams: null, wastePct: null }, "kg")).toBeNull();
  });
  it("kostendring per enhet = mengde × prisendring / antall per bakst", () => {
    const r = productDrivers([{ rawMaterialId: "mel", quantity: null, unit: null, quantityGrams: 5000, wastePct: 0 }], ch, 10);
    expect(r.drivers[0].deltaPerUnit).toBeCloseTo(1);
  });
  it("dokumentasjonen bruker norske tall", () => {
    const t = documentationText({
      productName: "Grovbrød", listName: "Engros", periodLabel: "12 mnd",
      drivers: [{ rawMaterialId: "mel", name: "Hvetemel", deltaPerUnit: 1 }], changes: ch,
      priceNow: 40, newPrice: 42, now: marginFigures(40, { raw: 10, labor: 5, energy: 0, pack: 0 }, true),
      next: marginFigures(42, { raw: 10, labor: 5, energy: 0, pack: 0 }, true),
    });
    expect(t).toContain("25,0 %");
    expect(t).toContain("8,00 kr → 10,00 kr per kg");
    expect(t).toContain("42,00 kr");
  });
});
