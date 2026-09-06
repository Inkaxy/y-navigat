import { describe, it, expect } from "vitest";
import { normalizeMatchKey, matchKeyEquals } from "@/fakturaer/lib/matchNormalize";

describe("normalizeMatchKey", () => {
  it("fjerner diakritika, men beholder æ, ø og å", () => {
    expect(normalizeMatchKey("Crème")).toBe("creme");
    expect(normalizeMatchKey("Rød")).toBe("rød");
    expect(normalizeMatchKey("Blåbær")).toBe("blåbær");
    expect(normalizeMatchKey("Ærlig")).toBe("ærlig");
  });

  it("fjerner ledende nuller i rene tallstrenger", () => {
    expect(normalizeMatchKey("007")).toBe("7");
    expect(normalizeMatchKey("000")).toBe("0");
    expect(normalizeMatchKey("0012A")).toBe("0012a");
  });

  it("gjør tegnsetting til mellomrom og komprimerer", () => {
    expect(normalizeMatchKey("Smør-25.kg")).toBe("smør 25 kg");
    expect(normalizeMatchKey("  Hvete   mel  ")).toBe("hvete mel");
    expect(normalizeMatchKey("Egg (10 stk)")).toBe("egg 10 stk");
  });

  it("håndterer tomme verdier", () => {
    expect(normalizeMatchKey(null)).toBe("");
    expect(normalizeMatchKey(undefined)).toBe("");
    expect(normalizeMatchKey("   ")).toBe("");
  });

  it("matchKeyEquals krever ikke-tomme og like nøkler", () => {
    expect(matchKeyEquals("Crème Fraîche", "creme fraiche")).toBe(true);
    expect(matchKeyEquals("", "")).toBe(false);
    expect(matchKeyEquals("smør", "melk")).toBe(false);
  });
});
