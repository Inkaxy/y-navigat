import { describe, expect, it } from "vitest";
import { guessLineKind, lineClarifications, packageFromText, rankedSuggestions, type InsightLine } from "@/fakturaer/lib/lineInsight";

const florapan: InsightLine = {
  description: "Florapan L62 k, pose 100 g",
  quantity: 10, unit: "sekk", unit_price: 977.74, total_amount: 6697.5,
  invoice: { is_credit_note: false },
  matched_raw_material: { name: "Florapan L62 k, pose 100 g", category: "Emballasje", item_type: "emballasje", base_unit: "stk" },
};

describe("pakning fra varetekst er forslag", () => {
  it.each([
    ["Mel 6x1kg", 6, 6, "kg"],
    ["Rosiner 36x90g", 36, 3.24, "kg"],
    ["Olje 4 × 2,5 l", 4, 10, "l"],
  ])("%s", (d, count, total, unit) => {
    const p = packageFromText(d)!;
    expect(p.count).toBe(count);
    expect(p.total).toBeCloseTo(total, 6);
    expect(p.totalUnit).toBe(unit);
  });
  it("enkel vekt", () => expect(packageFromText("Florapan L62 k, pose 100 g")).toMatchObject({ count: null, total: 0.1, totalUnit: "kg" }));
  it("ingen eller tvetydig gir null", () => {
    expect(packageFromText("Sukker")).toBeNull();
    expect(packageFromText("Mix 500 g / 1 kg")).toBeNull();
    expect(packageFromText("Type L62")).toBeNull();
  });
});

describe("Florapan-observasjonen", () => {
  const c = lineClarifications(florapan);
  it("fakturert per sekk mot stk-vare gir pakningsavklaring", () => {
    const u = c.find((x) => x.id === "unit_conflict")!;
    expect(u.action).toBe("pakning");
    expect(u.detail).toContain("100 g");
  });
  it("regnestykket går til originalen via felles lesekontroll (mulig rabatt)", () => {
    const r = c.find((x) => x.id === "read_issue")!;
    expect(r.action).toBe("original");
    expect(r.blocksPrice).toBe(true);
    expect(r.detail).toMatch(/rabatt/i);
  });
});

describe("reproduserte feil", () => {
  it("6x1kg / 10 kg er motstrid → ukjent", () => expect(packageFromText("Mel 6x1kg / 10 kg")).toBeNull());
  it("6x1kg / 6 kg er samstemt", () => expect(packageFromText("Mel 6x1kg / 6 kg")?.total).toBe(6));
  it("2x6x1kg = 12 kg", () => expect(packageFromText("Mel 2x6x1kg")).toMatchObject({ count: 12, total: 12, totalUnit: "kg" }));
  it("smør 500 g solgt per stk, handelsvare i stk, går opp: ingen avklaring", () => {
    expect(lineClarifications({ description: "Smør 500g", quantity: 2, unit: "stk", unit_price: 40, total_amount: 80, invoice: { is_credit_note: false },
      matched_raw_material: { name: "Smør 500 g", category: null, item_type: "handelsvare", base_unit: "stk" } })).toEqual([]);
  });
  it("kreditnota -2 × 10 = -20 er korrekt", () => {
    expect(lineClarifications({ description: "Smør", quantity: -2, unit: "stk", unit_price: 10, total_amount: -20, invoice: { is_credit_note: true } })).toEqual([]);
  });
  it("stk-vare med oppgitt antall per sekk gir ingen enhetskonflikt", () => {
    expect(lineClarifications({ ...florapan, count_per_package: 1000, total_amount: 9777.4 }).map((x) => x.id)).toEqual([]);
  });
});

describe("lesekontroll", () => {
  const base = { invoice: { is_credit_note: false }, unit: "krt" };
  it("kollipris i tekst forklares, men går til originalen", () => {
    const c = lineClarifications({ ...base, description: "Mel 6x1kg", quantity: 2, unit_price: 20, total_amount: 240 });
    expect(c.map((x) => x.action)).toEqual(["original"]);
    expect(c[0].detail).toContain("6x1kg");
  });
  it("regnestykke som går opp gir ingen avklaring", () => {
    expect(lineClarifications({ ...base, description: "Sukker 25 kg", quantity: 2, unit_price: 300, total_amount: 600 })).toEqual([]);
  });
  it("øreavrunding innenfor serverens toleranse godtas", () => {
    expect(lineClarifications({ ...base, description: "Gjær", quantity: 3, unit_price: 33.33, total_amount: 100 })).toEqual([]);
  });
  it("registrert rabatt går opp", () => {
    expect(lineClarifications({ ...base, description: "Mel", quantity: 10, unit_price: 100, total_amount: 900, discount_amount: 100 })).toEqual([]);
  });
  it("positivt beløp på kreditnota", () => {
    const c = lineClarifications({ description: "Mel", quantity: 1, unit: "stk", unit_price: 10, total_amount: 10, invoice: { is_credit_note: true } });
    expect(c.map((x) => x.id)).toContain("credit_sign");
  });
  it("kreditnota med negativt beløp", () => {
    expect(lineClarifications({ description: "Mel", quantity: 1, unit: "stk", unit_price: 10, total_amount: -10, invoice: { is_credit_note: true } })).toEqual([]);
  });
});

describe("linjetype", () => {
  it.each([
    ["Fraktgebyr", "frakt_gebyr_pant"],
    ["Pant palle", "frakt_gebyr_pant"],
    ["Volumrabatt", "rabatt_kreditt"],
  ])("%s", (d, k) => expect(guessLineKind({ description: d, quantity: 1, unit: null, unit_price: 1, total_amount: 1 }).kind).toBe(k));
  it("negativt beløp på vanlig faktura", () => expect(guessLineKind({ description: "X", quantity: 1, unit: null, unit_price: -5, total_amount: -5, invoice: { is_credit_note: false } }).kind).toBe("rabatt_kreditt"));
  it("emballasje fra koblet vare", () => expect(guessLineKind(florapan).kind).toBe("emballasje"));
  it("ukjent uten kobling", () => expect(guessLineKind({ description: "Hvetemel", quantity: 1, unit: null, unit_price: 1, total_amount: 1 }).kind).toBe("ukjent"));
});

describe("rangerte forslag", () => {
  it("maks tre, serverens rekkefølge, ingen duplikater, serverens begrunnelse", () => {
    const mk = (id: string, rank: number, reason: string | null) => ({ raw_material_id: id, rank, confidence: 0.5, match_reason: reason, raw_material: { name: id } });
    const r = rankedSuggestions({ description: "", quantity: 1, unit: null, unit_price: 1, total_amount: 1, suggestions: [mk("c", 3, "Råvarenavn"), mk("a", 1, "Alias-likhet (supplier_sku)"), mk("a", 2, "dup"), mk("b", 2, null), mk("d", 4, "x")] });
    expect(r.map((x) => x.rawMaterialId)).toEqual(["a", "b", "c"]);
    expect(r[0].reason).toBe("Alias-likhet (supplier_sku)");
    expect(r[1].reason).toBe("Ingen begrunnelse lagret");
  });
});
