import { describe, expect, it } from "vitest";
import { agreementBaseUnitsPerPackage } from "@/ravarer/lib/agreementPricing";
import { shouldAutosave } from "@/ravarer/lib/countDraft";

describe("agreementBaseUnitsPerPackage", () => {
  it("gir 20 kr/kg for 500 kr per 25 kg", () => {
    const units = agreementBaseUnitsPerPackage("", "25", "kg", "kg");
    expect(units).toBe(25);
    expect(500 / (units ?? 1)).toBe(20);
  });

  it("bruker eksplisitt innhold framfor pakningstallet", () => {
    expect(agreementBaseUnitsPerPackage("25", "1", "sekk", "kg")).toBe(25);
  });

  it("regner om enheter: 2 kg pakning på en råvare med gram", () => {
    expect(agreementBaseUnitsPerPackage("", "2", "kg", "g")).toBe(2000);
  });

  it("faller tilbake til pakningstallet ved ukjent emballasjeenhet", () => {
    expect(agreementBaseUnitsPerPackage("", "3", "sekk", "kg")).toBe(3);
  });

  it("gir null uten brukbare tall", () => {
    expect(agreementBaseUnitsPerPackage("", "", "kg", "kg")).toBeNull();
    expect(agreementBaseUnitsPerPackage("0", "0", "kg", "kg")).toBeNull();
  });
});

describe("shouldAutosave", () => {
  it("lagrer ikke rett etter at et utkast er lastet inn", () => {
    expect(shouldAutosave(true, false)).toBe(false);
  });

  it("lagrer når brukeren har endret noe", () => {
    expect(shouldAutosave(true, true)).toBe(true);
  });

  it("lagrer ikke før utkastet er lastet", () => {
    expect(shouldAutosave(false, false)).toBe(false);
  });
});
