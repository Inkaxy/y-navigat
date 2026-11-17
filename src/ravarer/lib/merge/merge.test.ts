import { describe, expect, it } from "vitest";
import { conversionFor, conversionReady, costInKeepUnit, needsWeight, unitFactor, weightPrefill } from "./units";
import { parseMergeFacts, parseMergeOutcome, suggestKeep, countRows, type MergeFacts } from "./facts";
import { findDuplicateGroups } from "./duplicates";

const fact = (p: Partial<MergeFacts> & { id: string }): MergeFacts => ({
  name: p.id, sku: p.id, item_type: "ravare", category: null, base_unit: "kg", cost: null, cost_status: null, created_at: "2026-01-01T00:00:00Z",
  is_active: true, unit_weight_grams: null, merged_into_id: null, merge_id: null, declaration_name: null, current_stock: 0, stock_tracking: false,
  suppliers: [], invoice_lines: 0, recipes: 0, calc_additions: 0, products: 0, price_lists: 0, stock_movements: 0, count_templates: 0,
  has_nutrition: false, allergens: 0, datasheets: 0, cost_posted_lines: 0, ...p,
});

describe("omregning ved ulik grunnenhet", () => {
  it("kg mot stk uten stykkvekt kan ikke slås sammen", () => {
    expect(needsWeight("kg", "stk")).toBe(true);
    expect(unitFactor("kg", "stk", null)).toBeNull();
    const c = conversionFor("kg", "stk", "");
    expect(conversionReady(c)).toBe(false);
    expect(conversionReady(conversionFor("kg", "stk", "0"))).toBe(false);
  });
  it("1 stk = 120 g: 29,88 kr/stk blir 249 kr/kg, og 249,07 kr/kg blir 29,89 kr/stk", () => {
    const toKg = conversionFor("kg", "stk", "120");
    expect(toKg).toMatchObject({ kind: "weight", grams: 120 });
    expect(conversionReady(toKg)).toBe(true);
    expect(costInKeepUnit(29.88, unitFactor("kg", "stk", 120))).toBeCloseTo(249, 6);
    expect(costInKeepUnit(249.07, unitFactor("stk", "kg", 120))).toBeCloseTo(29.8884, 4);
  });
  it("kg mot liter kan ikke regnes om her; samme enhet trenger ingenting", () => {
    expect(conversionFor("kg", "l", "120")).toEqual({ kind: "impossible" });
    expect(conversionFor("stk", "stk", "")).toEqual({ kind: "same", factor: 1 });
  });
  it("forslag til stykkvekt fra pakning skrevet i vekt", () => {
    const stk = { base_unit: "stk", unit_weight_grams: null, suppliers: [{ supplier_id: "s", package_size: 2.4, package_unit: "kg", base_units_per_package: 20 }] };
    const kg = { base_unit: "kg", unit_weight_grams: null, suppliers: [] };
    expect(weightPrefill(kg, stk)).toBe(120);
    expect(weightPrefill(kg, { ...stk, unit_weight_grams: 95 })).toBe(95);
    expect(weightPrefill(kg, { ...stk, suppliers: [] })).toBeNull();
  });
});

describe("forslag til vare som beholdes", () => {
  it("den som brukes i oppskrifter vinner, så verifisert kost, så eldst", () => {
    expect(suggestKeep([fact({ id: "a", cost: 10, cost_status: "verifisert" }), fact({ id: "b", recipes: 2 })])).toEqual({ id: "b", reason: "brukes" });
    expect(suggestKeep([fact({ id: "a", created_at: "2026-01-01" }), fact({ id: "b", cost: 5, cost_status: "verifisert", created_at: "2026-11-17" })])).toEqual({ id: "b", reason: "verifisert" });
    expect(suggestKeep([fact({ id: "a", created_at: "2026-11-17" }), fact({ id: "b", created_at: "2026-08-08" })])).toEqual({ id: "b", reason: "eldst" });
  });
});

describe("svarlesere", () => {
  it("uleselig svar er ukjent, aldri slått sammen", () => {
    expect(parseMergeOutcome({})).toBeNull();
    expect(parseMergeOutcome({ ok: true, dry_run: false, can_apply: true, merge_id: null, keep_id: "k", merged_ids: [], counts: {} })).toBeNull();
    expect(parseMergeOutcome({ ok: false })).toBeNull();
  });
  it("avvisning med kode og enheter", () => {
    expect(parseMergeOutcome({ ok: false, code: "omregning_mangler", keep_unit: "kg", dup_unit: "stk" })).toMatchObject({ ok: false, code: "omregning_mangler", keepUnit: "kg", dupUnit: "stk" });
  });
  it("forhåndsvisning med tall og konflikter", () => {
    const r = parseMergeOutcome({ ok: true, dry_run: true, can_apply: false, merge_id: null, keep_id: "k", merged_ids: ["d"],
      counts: { fakturalinjer: 3, oppskrifter: 1 }, conflicts: [{ code: "kostpris_fort", text: "x", blocking: true }],
      cost: { before: { price: 29.88, status: "verifisert", unit: "stk" }, after: null }, grams_per_piece: 120 });
    expect(r).toMatchObject({ ok: true, canApply: false, gramsPerPiece: 120 });
    expect(countRows(r && r.ok ? r.counts : {}).map((c) => c.label)).toEqual(["Fakturalinjer", "Oppskrifter"]);
  });
  it("fakta krever alle tall", () => {
    expect(parseMergeFacts({ ok: true, items: [{ id: "x" }] })).toBeNull();
    expect(parseMergeFacts({ ok: false, code: "ingen_tilgang" })).toEqual({ ok: false, code: "ingen_tilgang" });
  });
});

describe("mulige duplikater", () => {
  const items = [
    { id: "pals-kg", name: "Gluten og melkefri kanelbolle", is_active: true },
    { id: "pals-stk", name: "GLUTEN OG MELKEFRI KANELBOLLE", is_active: true },
    { id: "sirup-70", name: "KANELBOLLE SIRUP 70CL MONIN", is_active: true },
    { id: "sirup", name: "KANELBOLLE SIRUP MONIN", is_active: true },
    { id: "mel", name: "Hvetemel", is_active: true },
    { id: "gammel", name: "KANELBOLLE SIRUP MONIN", is_active: false },
  ];
  const links = [
    { raw_material_id: "pals-kg", supplier_id: "pals", supplier_name: "A/S PALS", supplier_sku: "8009", supplier_product_name: null },
    { raw_material_id: "pals-stk", supplier_id: "pals", supplier_name: "A/S PALS", supplier_sku: "8009", supplier_product_name: null },
    { raw_material_id: "sirup-70", supplier_id: "asko", supplier_name: "ASKO ØST AS", supplier_sku: "3507", supplier_product_name: null },
    { raw_material_id: "sirup", supplier_id: "asko", supplier_name: "ASKO ØST AS", supplier_sku: "305-1/1", supplier_product_name: null },
    { raw_material_id: "mel", supplier_id: "asko", supplier_name: "ASKO ØST AS", supplier_sku: "1", supplier_product_name: null },
    { raw_material_id: "gammel", supplier_id: "asko", supplier_name: "ASKO ØST AS", supplier_sku: "3507", supplier_product_name: null },
  ];
  it("fanger samme varenummer og svært like navn hos samme leverandør, ikke inaktive", () => {
    const g = findDuplicateGroups(items, links);
    expect(g.map((x) => x.ids.sort())).toEqual([["pals-kg", "pals-stk"], ["sirup", "sirup-70"]]);
    expect(g[0].reasons[0]).toEqual({ kind: "varenummer", supplierName: "A/S PALS", sku: "8009" });
    expect(g[1].reasons).toEqual([{ kind: "navn", supplierName: "ASKO ØST AS" }]);
  });
  it("lært varenummer teller som varenummer", () => {
    const g = findDuplicateGroups(items, [...links.slice(0, 4), { ...links[3], raw_material_id: "mel", supplier_sku: "9", sku_aliases: ["3507"] }]);
    expect(g.find((x) => x.ids.includes("mel"))?.reasons[0]).toMatchObject({ kind: "varenummer" });
  });
});
