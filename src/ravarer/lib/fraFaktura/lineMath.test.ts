import { describe, expect, it } from "vitest";
import { lineMath, unitPrices, type MathLine } from "./lineMath";
import { packageBadge, packageProposal, packageSourceLine, pricePerBase, readPackage } from "./newItems";

const base = { package_size: 0.7, package_unit: "l", description: "ISTE CHAI THE KONSENTRAT 0,7L", count_per_package: null } as const;
// ASKO 330732320 (28.10.2026): lest 1 flaske, men 6 × 108,05 − 32,42 = 615,88.
const chai1028: MathLine & { description: string } = { ...base, quantity: 1, unit: "flaske", unit_price: 108.05, total_amount: 615.9, discount_amount: 32.42,
  extraction_issues: [{ code: "regnestykke", message: "Mengde × pris (75.63) stemmer ikke med linjesummen (615.90)." }] };
// ASKO 330724431 (21.10.2026): samme vare lest rent.
const chai1021: MathLine & { description: string } = { ...base, quantity: 6, unit: "flaske", unit_price: 108.05, total_amount: 615.9, discount_amount: 32.42, extraction_issues: [] };
// ASKO 330364719 (01.10.2025): lest 1 flaske, 573,78 = 6 × 95,63, uten lagret merknad.
const chai1001: MathLine & { description: string } = { ...base, quantity: 1, unit: "flaske", unit_price: 95.63, total_amount: 573.78, extraction_issues: [] };
// ASKO 330716883 (PEACH): 1 eske à 6, pris per flaske 82,13, rabatt 27,10.
const peach: MathLine & { description: string } = { ...base, description: "ISTE PEACH KONSENTRAT 0,7L MON", quantity: 1, unit: "eske", count_per_package: 6, unit_price: 82.13, total_amount: 465.66, discount_amount: 27.1,
  extraction_issues: [{ code: "regnestykke", message: "Mengde × pris (55.03) stemmer ikke med linjesummen (465.66)." }] };

describe("Nye varer: regnestykket på linjen", () => {
  it("linjesum + trykt rabatt = n × enhetspris gir n flasker, ikke 1 (ISTE CHAI 330732320)", () => {
    const m = lineMath(chai1028);
    expect(m.clean).toBe(false);
    expect(m.units).toBe(6);
    expect(m.note).toContain("615,90 + 32,42 i rabatt = 6 × 108,05");
    const s = readPackage(packageProposal(chai1028, null, m), null);
    expect(s.state).toBe("valid");
    expect(pricePerBase(chai1028, s, m.units)).toBeCloseTo(615.9 / (6 * 0.7), 2); // ≈ 146,64 kr/l
    expect(unitPrices(chai1028, m)[0].amount).toBeCloseTo(102.65, 2); // kr per flaske
  });

  it("også uten lagret merknad: 573,78 = 6 × 95,63 gir 95,63 kr/flaske, ikke 573,78", () => {
    const m = lineMath(chai1001);
    expect(m.clean).toBe(false);
    expect(m.units).toBe(6);
    expect(unitPrices(chai1001, m)[0]).toEqual({ amount: 95.63, unit: "flaske" });
  });

  it("eske med lest antall per eske: prisen gjelder per stk, 1 eske = 6 × 0,7 l (PEACH)", () => {
    const m = lineMath(peach);
    expect(m).toMatchObject({ clean: false, units: 1, subUnits: 6 });
    const d = packageProposal(peach, null, m);
    expect(d).toMatchObject({ qty: "4,2", unit: "l", conflict: false });
    const s = readPackage(d, null);
    expect(pricePerBase(peach, s, m.units)).toBeCloseTo(110.87, 2);
    expect(unitPrices(peach, m).map((u) => u.unit)).toEqual(["eske", "stk"]);
  });

  it("eske uten lest antall: «1 eske = n stk» som forslag", () => {
    const l: MathLine & { description: string } = { quantity: 1, unit: "eske", unit_price: 10, total_amount: 120, package_size: null, package_unit: null, count_per_package: null, description: "SERVIETTER" };
    const m = lineMath(l);
    expect(m).toMatchObject({ units: 1, subUnits: 12 });
    expect(packageProposal(l, null, m)).toMatchObject({ qty: "12", unit: "stk" });
  });

  it("ren linje er ren, og et ukjent regnestykke gir ingen pris", () => {
    expect(lineMath(chai1021)).toMatchObject({ clean: true, units: 6, note: null });
    const odd = lineMath({ ...chai1001, total_amount: 500 });
    expect(odd).toMatchObject({ clean: false, units: null });
    expect(pricePerBase(chai1001, readPackage(packageProposal(chai1001), null), odd.units)).toBeNull();
  });

  it("pakningen bygges fra en rent lest linje for samme vare når den finnes", () => {
    const clean = (l: MathLine) => lineMath(l).clean;
    expect(packageSourceLine([chai1028, chai1021], [chai1028, chai1021], clean)).toBe(chai1021);
    expect(packageSourceLine([chai1028], [chai1028, chai1001, chai1021], clean)).toBe(chai1021);
    expect(packageSourceLine([chai1028], [chai1028], clean)).toBe(chai1028);
  });

  it("pris fra en linje med merknad er aldri «Sikker»", () => {
    const d = packageProposal(chai1028, null, lineMath(chai1028));
    const state = readPackage(d, null);
    expect(packageBadge({ text: "ISTE CHAI", draft: d, state, mode: "opprett", hasSuggestion: false, numbersOk: false })).toBe("sjekk_tall");
    expect(packageBadge({ text: "ISTE CHAI", draft: d, state, mode: "opprett", hasSuggestion: false, numbersOk: true })).toBe("sikker");
  });
});
