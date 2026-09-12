import { describe, expect, it } from "vitest";
import {
  restoreLoadedPrices,
  resolveLineVatRate,
  type LoadedLinePrice,
  type RepricableLine,
} from "@/ordre/lib/orderRepricing";

const baseline = new Map<string, LoadedLinePrice>([
  ["l1", { unit_price: "42.5", source: "price_list", source_id: "pl-1", effective: 42.5 }],
  ["l2", { unit_price: "10", source: "special_price", source_id: "sp-1", effective: 10 }],
]);

const line = (over: Partial<RepricableLine> & { id?: string }): RepricableLine => ({
  unit_price: "0",
  ...over,
});

describe("gjenoppretting av avtalte priser ved retur til opprinnelig dato", () => {
  it("setter tilbake pris og kilde etter en tur innom en annen dato", () => {
    const afterOtherDate = [
      line({ id: "l1", unit_price: "55", unit_price_source: "price_list", unit_price_source_id: "pl-9" }),
    ];
    const [restored] = restoreLoadedPrices(afterOtherDate, baseline);
    expect(restored.unit_price).toBe("42.5");
    expect(restored.unit_price_source).toBe("price_list");
    expect(restored.unit_price_source_id).toBe("pl-1");
    expect(restored.base_price_source_id).toBe("pl-1");
    expect(restored.effective_price).toBe(42.5);
    expect(restored.is_fallback).toBe(false);
  });

  it("rører ikke en eksplisitt manuell pris", () => {
    const lines = [
      line({ id: "l2", unit_price: "99", unit_price_source: "manual_override", unit_price_source_id: null }),
    ];
    expect(restoreLoadedPrices(lines, baseline)[0].unit_price).toBe("99");
  });

  it("lar nye linjer uten id stå urørt", () => {
    const lines = [line({ unit_price: "31", unit_price_source: "price_list" })];
    expect(restoreLoadedPrices(lines, baseline)[0].unit_price).toBe("31");
  });

  it("lar linjer som ikke finnes i grunnlaget stå urørt", () => {
    const lines = [line({ id: "ukjent", unit_price: "7" })];
    expect(restoreLoadedPrices(lines, baseline)[0].unit_price).toBe("7");
  });
});

describe("mva-sats ved lagring", () => {
  it("beholder faktisk lagret sats over produktets standard", () => {
    expect(resolveLineVatRate(25, 15)).toBe(25);
    expect(resolveLineVatRate(0, 15)).toBe(0);
    expect(resolveLineVatRate(15, 25)).toBe(15);
  });

  it("bruker produktets sats når linjen ikke har lagret sats", () => {
    expect(resolveLineVatRate(null, 25)).toBe(25);
    expect(resolveLineVatRate(undefined, 0)).toBe(0);
  });

  it("faller tilbake til 15 når ingenting er kjent", () => {
    expect(resolveLineVatRate(null, null)).toBe(15);
    expect(resolveLineVatRate(Number.NaN, undefined)).toBe(15);
  });
});
