import { describe, expect, it } from "vitest";
import {
  isPositiveNorwegianDecimal,
  parseNorwegianDecimal,
} from "@/varer/lib/norwegianNumber";
import { unitOptionsFor } from "@/varer/components/recipes/unitOptions";

describe("norsk desimaltall i «Ny variant»", () => {
  it("godtar komma", () => {
    expect(parseNorwegianDecimal("0,5")).toBe(0.5);
    expect(isPositiveNorwegianDecimal("0,5")).toBe(true);
  });

  it("godtar punktum og mellomrom", () => {
    expect(parseNorwegianDecimal(" 1.25 ")).toBe(1.25);
  });

  it("avviser tomt, tekst og doble skilletegn", () => {
    expect(Number.isNaN(parseNorwegianDecimal(""))).toBe(true);
    expect(Number.isNaN(parseNorwegianDecimal("halv"))).toBe(true);
    expect(Number.isNaN(parseNorwegianDecimal("0,5,5"))).toBe(true);
  });

  it("avviser null og negative faktorer", () => {
    expect(isPositiveNorwegianDecimal("0")).toBe(false);
    expect(isPositiveNorwegianDecimal("-0,5")).toBe(false);
    expect(parseNorwegianDecimal("-0,5")).toBe(-0.5);
  });
});

describe("enhetsvalg på oppskriftslinjer", () => {
  it("viser kjente enheter uten duplikater", () => {
    expect(unitOptionsFor("g")).toEqual(["g", "kg", "ml", "cl", "dl", "l", "stk"]);
  });

  it("beholder eldre lagrede enheter som «liter» øverst", () => {
    expect(unitOptionsFor("liter")[0]).toBe("liter");
    expect(unitOptionsFor("liter")).toContain("l");
  });

  it("tåler tom enhet uten å vise et tomt valg to ganger", () => {
    expect(unitOptionsFor("")).toEqual(["g", "kg", "ml", "cl", "dl", "l", "stk"]);
    expect(unitOptionsFor(null)).toEqual(["g", "kg", "ml", "cl", "dl", "l", "stk"]);
  });
});
