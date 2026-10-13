import { describe, expect, it } from "vitest";
import { parseNumberToken, resolveLineNumbers } from "../../supabase/functions/_shared/numberTokens";
import { sanitizeLines } from "../../supabase/functions/_shared/invoiceExtraction";

const v = (s: string) => parseNumberToken(s).value;

describe("trykte tallformater (syntetiske)", () => {
  it("norsk komma, punktum som desimal, mellomrom og NBSP som tusenskille", () => {
    expect(v("1 234,50")).toBe(1234.5);
    expect(v("1\u00a0234,50")).toBe(1234.5);
    expect(v("1\u202f234\u202f567,00")).toBe(1234567);
    expect(v("1.234,50")).toBe(1234.5);
    expect(v("1,234.50")).toBe(1234.5);
    expect(v("110.00")).toBe(110);
    expect(v("12,5")).toBe(12.5);
    expect(v("kr 1 234,50")).toBe(1234.5);
    expect(v("1 234,50 NOK")).toBe(1234.5);
    expect(v("100,-")).toBe(100);
  });
  it("negative tall: minus, unicode-minus, parentes, etterstilt minus", () => {
    expect(v("-1 234,50")).toBe(-1234.5);
    expect(v("\u22121 234,50")).toBe(-1234.5);
    expect(v("(1 234,50)")).toBe(-1234.5);
    expect(v("(kr 120,00)")).toBe(-120);
    expect(v("1 234,50-")).toBe(-1234.5);
    expect(v("20,00 -")).toBe(-20);
  });
  it("ugyldig tusengruppe og dobbelt fortegn avvises", () => {
    expect(parseNumberToken("1 23,00")).toMatchObject({ value: null, ambiguous: false, candidates: [] });
    expect(v("12 3456")).toBeNull();
    expect(v("1.23.456")).toBeNull();
    expect(v("1.2345,00")).toBeNull();
    expect(v("1,234,5.00")).toBeNull();
    expect(v("1.234,5,0")).toBeNull();
    expect(v("(-12,00)")).toBeNull();
    expect(v("-12,00-")).toBeNull();
    expect(v("12,")).toBeNull();
  });
  it("tvetydige former gir kandidater, ikke gjetning", () => {
    expect(parseNumberToken("10.000")).toMatchObject({ value: null, ambiguous: true, candidates: [10, 10000] });
    expect(parseNumberToken("1,250")).toMatchObject({ value: null, ambiguous: true, candidates: [1.25, 1250] });
    expect(parseNumberToken("(10.000)")).toMatchObject({ ambiguous: true, candidates: [-10, -10000] });
    // Heltallsdel 0 kan ikke være tusenskille.
    expect(v("0,500")).toBe(0.5);
    expect(v("0.250")).toBe(0.25);
    // Mellomrom som tusenskille avgjør at skilletegnet er desimal.
    expect(v("1 234.500")).toBe(1234.5);
  });
});

describe("linjeregnestykket avgjør tvetydighet (eksisterende regel bevart)", () => {
  it("Tripletex: «10.000» kg × «110,00» = «1 100,00»", () => {
    const r = resolveLineNumbers({ quantity_raw: "10.000", unit_price_raw: "110,00", total_amount_raw: "1 100,00" });
    expect(r).toMatchObject({ quantity: 10, unit_price: 110, total_amount: 1100, unresolved: [], invalid: [] });
  });
  it("«1,250» kg × 80 = 100 avgjøres som 1,25", () => {
    const r = resolveLineNumbers({ quantity_raw: "1,250", unit_price_raw: "80,00", total_amount_raw: "100,00" });
    expect(r.quantity).toBe(1.25);
  });
  it("tvetydig uten løsning forblir ukjent", () => {
    const r = resolveLineNumbers({ quantity_raw: "10.000", unit_price_raw: "3,00", total_amount_raw: "999,00" });
    expect(r.quantity).toBeNull();
    expect(r.unresolved).toEqual(["quantity"]);
  });
  it("ugyldig råtekst erstattes aldri av modelltallet", () => {
    const r = resolveLineNumbers({ quantity: 2, quantity_raw: "2", unit_price: 10, unit_price_raw: "10,00", total_amount: 20, total_amount_raw: "2 0,00" });
    expect(r.total_amount).toBeNull();
    expect(r.invalid).toEqual(["total_amount"]);
  });
});

describe("leserens normalisering (sanitizeLines)", () => {
  const base = { line_kind: "vare", description: "Mel", unit: "stk", unit_price_basis: "per_unit", confidence: 0.9 };
  it("kreditnota i parentes beholder fortegnet og går opp", () => {
    const [l] = sanitizeLines([{ ...base, quantity_raw: "(2)", unit_price_raw: "10,00", total_amount_raw: "(20,00)" }], true);
    expect(l).toMatchObject({ quantity: -2, unit_price: 10, total_amount: -20 });
    expect(l.read_issues).toEqual([]);
  });
  it("etterstilt minus på vanlig faktura flagges som fortegn, ikke snudd", () => {
    const [l] = sanitizeLines([{ ...base, quantity_raw: "2", unit_price_raw: "10,00", total_amount_raw: "20,00-" }]);
    expect(l.total_amount).toBe(-20);
    expect(l.read_issues.map((i) => i.code)).toContain("fortegn");
  });
  it("modellens positive tall overstyres av trykt negativt beløp", () => {
    const [l] = sanitizeLines([{ ...base, line_kind: "rabatt", quantity: 1, unit_price: 50, total_amount: 50, total_amount_raw: "50,00-" }]);
    expect(l.total_amount).toBe(-50);
  });
  it("ugyldig tusengruppe gir kontrollbehov", () => {
    const [l] = sanitizeLines([{ ...base, quantity_raw: "1", unit_price_raw: "1 23,00", total_amount_raw: "123,00" }]);
    expect(l.unit_price).toBeNull();
    expect(l.read_issues.map((i) => i.code)).toContain("ugyldig_tall");
  });
  it("rabatt normaliseres ikke: trykt pris og rabatt beholdes, regnestykket kontrolleres", () => {
    const [ok] = sanitizeLines([{ ...base, quantity_raw: "10", unit_price_raw: "100,00", total_amount_raw: "900,00", discount_pct: "10" }]);
    expect(ok).toMatchObject({ unit_price: 100, total_amount: 900, discount_pct: 10, discount_amount: 100 });
    expect(ok.read_issues).toEqual([]);
    const [miss] = sanitizeLines([{ ...base, quantity_raw: "10", unit_price_raw: "100,00", total_amount_raw: "900,00" }]);
    expect(miss.unit_price).toBe(100);
    expect(miss.read_issues.map((i) => i.code)).toContain("mulig_rabatt");
  });
  it("kollipris uten oppgitt grunnlag flagges, ikke pyntet", () => {
    const [l] = sanitizeLines([{ ...base, unit_price_basis: null, unit: "eske", package_size: 90, package_unit: "g", count_per_package: 36,
      quantity_raw: "6", unit_price_raw: "4,50", total_amount_raw: "972,00" }]);
    expect(l).toMatchObject({ quantity: 6, unit_price: 4.5, total_amount: 972, price_basis: null });
    expect(l.read_issues.map((i) => i.code)).toContain("prisgrunnlag_uavklart");
  });
  it("ulike pakninger: per_base kg med 24 sekk à 25 kg", () => {
    const [l] = sanitizeLines([{ ...base, unit: "sekk", unit_price_basis: "per_base", package_size: 25, package_unit: "kg",
      quantity_raw: "24", unit_price_raw: "12,50", total_amount_raw: "7 500,00" }]);
    expect(l).toMatchObject({ quantity: 24, total_amount: 7500, price_basis: "kg" });
    expect(l.read_issues).toEqual([]);
  });
});
