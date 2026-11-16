import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESALE_FACTOR, applyMarkupDraft, cellStatus, effectiveFactor, indexMarkups, isBlocked, isNoMarkupList,
  marginPerUnit, parseFactor, purchasePerSoldUnit, suggestedPrice, toListPrice,
} from "./handelsvarer";

const verified = { costPrice: 1.45, costStatus: "verifisert" };

describe("handelsvarer: påslag", () => {
  it("standard påslag er faktor 1,2", () => {
    expect(DEFAULT_RESALE_FACTOR).toBe(1.2);
    expect(effectiveFactor(indexMarkups([], null), "rm", "pl")).toEqual({ factor: 1.2, source: "standard" });
  });
  it("vare × prisliste vinner over vare, prisliste og selskap", () => {
    const idx = indexMarkups([
      { priceListId: "pl", rawMaterialId: null, factor: 1.3, blocked: false },
      { priceListId: null, rawMaterialId: "rm", factor: 1.4, blocked: false },
      { priceListId: "pl", rawMaterialId: "rm", factor: 1.5, blocked: false },
    ], 1.25);
    expect(effectiveFactor(idx, "rm", "pl")).toEqual({ factor: 1.5, source: "vare_prisliste" });
    expect(effectiveFactor(idx, "rm", "annen")).toEqual({ factor: 1.4, source: "vare" });
    expect(effectiveFactor(idx, "annen", "pl")).toEqual({ factor: 1.3, source: "prisliste" });
    expect(effectiveFactor(idx, "annen", "annen")).toEqual({ factor: 1.25, source: "selskap" });
  });
  it("sperre per prisliste uten faktor faller tilbake til prisgruppens faktor", () => {
    const idx = indexMarkups([{ priceListId: "pl", rawMaterialId: "rm", factor: null, blocked: true }], null);
    expect(isBlocked(idx, "rm", "pl")).toBe(true);
    expect(effectiveFactor(idx, "rm", "pl").source).toBe("standard");
  });
  it("«10 TILBUD» og «Utsalg» får ikke påslag", () => {
    expect(isNoMarkupList("tilbud")).toBe(true);
    expect(isNoMarkupList("utsalg_base")).toBe(true);
    expect(isNoMarkupList("engros_base")).toBe(false);
  });
  it("kladd legges over lagrede påslag", () => {
    const rows = applyMarkupDraft(
      [{ priceListId: "pl", rawMaterialId: null, factor: 1.3, blocked: false }],
      [{ kind: "list", priceListId: "pl", factor: 1.1 }, { kind: "cell", priceListId: "pl", rawMaterialId: "rm", factor: null, blocked: true }],
    );
    const idx = indexMarkups(rows, null);
    expect(idx.list.get("pl")).toBe(1.1);
    expect(isBlocked(idx, "rm", "pl")).toBe(true);
  });
  it("faktor leses med norsk desimalkomma og må være 0,5–10", () => {
    expect(parseFactor("1,2")).toBe(1.2);
    expect(parseFactor("1.35")).toBe(1.35);
    expect(parseFactor("0,4")).toBeNull();
    expect(parseFactor("abc")).toBeNull();
  });
});

describe("handelsvarer: innpris og forslag", () => {
  it("innpris per solgt vare = verifisert kost × antall per vare", () => {
    expect(purchasePerSoldUnit(verified, { baseUnitsPerSoldUnit: 24 })).toBeCloseTo(34.8);
  });
  it("uverifisert kost gir ingen innpris (som rm_usable_cost)", () => {
    expect(purchasePerSoldUnit({ costPrice: 1.45, costStatus: "foreslatt" }, { baseUnitsPerSoldUnit: 24 })).toBeNull();
    expect(purchasePerSoldUnit(verified, null)).toBeNull();
  });
  it("forslag = innpris × faktor, to desimaler", () => {
    expect(suggestedPrice(34.8, 1.2)).toBe(41.76);
    expect(suggestedPrice(null, 1.2)).toBeNull();
  });
  it("prislister inkl. mva får forslaget med mva", () => {
    expect(toListPrice(41.76, true, 25)).toBe(52.2);
    expect(toListPrice(41.76, false, 25)).toBe(41.76);
  });
  it("ny innpris gir forslag, men lik pris gir ikke", () => {
    expect(cellStatus({ blocked: false, noMarkup: false, linked: true, suggested: 41.76, current: 40 }).kind).toBe("forslag");
    expect(cellStatus({ blocked: false, noMarkup: false, linked: true, suggested: 41.76, current: 41.76 }).kind).toBe("lik");
    expect(cellStatus({ blocked: true, noMarkup: false, linked: true, suggested: 41.76, current: 40 }).kind).toBe("sperret");
    expect(cellStatus({ blocked: false, noMarkup: true, linked: true, suggested: 41.76, current: 40 }).kind).toBe("uten_pasla");
    expect(cellStatus({ blocked: false, noMarkup: false, linked: false, suggested: null, current: null }).kind).toBe("ikke_koblet");
  });
  it("igjen per forpakning = salgspris − innpris", () => {
    expect(marginPerUnit(41.76, 34.8)).toBe(6.96);
    expect(marginPerUnit(null, 34.8)).toBeNull();
  });
});
