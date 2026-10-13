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
  it("fanger vekt i tekst mot stk-emballasje", () => {
    expect(c.find((x) => x.id === "text_weight_vs_piece")?.detail).toContain("100 g");
  });
  it("fanger at 10 × 977,74 ikke er 6697,5 og antyder rabatt", () => {
    const gap = c.find((x) => x.id === "arithmetic_gap")!;
    expect(gap.blocksPrice).toBe(true);
    expect(gap.detail).toMatch(/mulig rabatt/);
  });
});

describe("lesekontroll", () => {
  const base = { invoice: { is_credit_note: false }, unit: "krt" };
  it("kollipris: mengde × antall i kolli × pris = sum", () => {
    const c = lineClarifications({ ...base, description: "Mel 6x1kg", quantity: 2, unit_price: 20, total_amount: 240 });
    expect(c.map((x) => x.id)).toEqual(["collo_price"]);
  });
  it("regnestykke som går opp gir ingen avklaring", () => {
    expect(lineClarifications({ ...base, description: "Sukker 25 kg", quantity: 2, unit_price: 300, total_amount: 600 })).toEqual([]);
  });
  it("innenfor 1 % toleranse godtas (øreavrunding)", () => {
    expect(lineClarifications({ ...base, description: "Gjær", quantity: 3, unit_price: 33.33, total_amount: 100 })).toEqual([]);
  });
  it("positivt beløp på kreditnota", () => {
    const c = lineClarifications({ description: "Mel", quantity: 1, unit: "stk", unit_price: 10, total_amount: 10, invoice: { is_credit_note: true } });
    expect(c.map((x) => x.id)).toContain("credit_sign");
  });
  it("kreditnota med negativt beløp regnes på absoluttverdi", () => {
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
