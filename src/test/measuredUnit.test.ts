import { describe, expect, it } from "vitest";
import { measuredBasis } from "@/fakturaer/lib/measuredUnit";

describe("målt enhet (bulk/silo) i pakningsskjemaet", () => {
  it("positiv kg-linje mot kg-vare: identitet, ingen pakning, ingen 25 kg-faktor", () => {
    const r = measuredBasis("kg", 23840, "kg");
    expect(r.kind).toBe("direct");
    if (r.kind === "direct") { expect(r.factor).toBe(1); expect(r.baseQuantity).toBe(23840); expect(r.text).not.toMatch(/inneholder/); }
  });
  it("varierende levert kg gir hver sin mengde", () => {
    const a = measuredBasis("kg", 23840, "kg"); const b = measuredBasis("kg", 27115.5, "kg");
    expect(a.kind === "direct" && b.kind === "direct" && a.baseQuantity !== b.baseQuantity).toBe(true);
  });
  it("kreditlinje -3000 kg forklares som kredit, ikke manglende vekt", () => {
    const r = measuredBasis("kg", -3000, "kg");
    expect(r.kind).toBe("credit");
    if (r.kind === "credit") { expect(r.baseQuantity).toBe(-3000); expect(r.text).toMatch(/Kredit/); expect(r.text).not.toMatch(/mangler/); }
  });
  it("g mot kg regnes om uten pakning", () => {
    const r = measuredBasis("g", 500, "kg");
    expect(r.kind === "direct" && r.baseQuantity).toBe(0.5);
  });
  it("bulk uten vekt er tvetydig og ber om kg, gjetter aldri kapasitet", () => {
    const r = measuredBasis("bulk", 1, "kg");
    expect(r.kind).toBe("needs_kg");
  });
  it("sekk mot kg krever fortsatt pakning", () => {
    expect(measuredBasis("sekk", 10, "kg").kind).toBe("package");
  });
});
