import { describe, it, expect } from "vitest";
import { computeRecipeUsage, sumQuantities, usageLineCost, SHARE_UNKNOWN, type UsageLineInput } from "@/ravarer/lib/recipeUsage";
import type { BakersRawMaterial } from "@/varer/lib/bakers";

const rm = (id: string, o: Partial<BakersRawMaterial>): BakersRawMaterial => ({ id, name: id, base_unit: "kg", current_cost_price: 60.6035, cost_basis_status: "verifisert", ...o });
let n = 0;
const line = (o: Partial<UsageLineInput>): UsageLineInput => ({ id: `l${++n}`, recipe_id: "r1", recipe_part_id: "p", raw_material_id: "M", sub_product_id: null, ingredient_name: null, quantity: 900, unit: "g", waste_percent: null, ...o });
const recipes = new Map([["r1", { name: "Brød", status: null }]]);

describe("råvarekortets oppskriftskost — felles linjemotor", () => {
  it("900 g × 60,6035 kr/kg = 54,54315 (ikke 54 543)", () => {
    expect(usageLineCost(line({}), rm("M", {})).cost).toBeCloseTo(54.54315, 6);
    expect(usageLineCost(line({ quantity: 1010 }), rm("M", {})).cost).toBeCloseTo(61.209535, 6);
  });
  it("g/g, ml/l uten tetthet, stk med/uten vekt", () => {
    expect(usageLineCost(line({ quantity: 100 }), rm("M", { base_unit: "g", current_cost_price: 2 })).cost).toBeCloseTo(200);
    expect(usageLineCost(line({ quantity: 500, unit: "ml" }), rm("M", { base_unit: "l", current_cost_price: 40 })).cost).toBeCloseTo(20);
    expect(usageLineCost(line({ quantity: 150 }), rm("M", { base_unit: "stk", current_cost_price: 10, unit_weight_grams: 50 })).cost).toBeCloseTo(30);
    expect(usageLineCost(line({ quantity: 150 }), rm("M", { base_unit: "stk", current_cost_price: 10 })).cost).toBeNull();
  });
  it("vekt mot volumpris krever tetthet", () => {
    expect(usageLineCost(line({ quantity: 100 }), rm("M", { base_unit: "l", current_cost_price: 40 })).cost).toBeNull();
    expect(usageLineCost(line({ quantity: 100 }), rm("M", { base_unit: "l", current_cost_price: 40, density_g_per_ml: 1 })).cost).toBeCloseTo(4);
  });
  it("null pris ≠ 0; verifisert 0 er ekte 0; uverifisert samme tall er ukjent", () => {
    expect(usageLineCost(line({}), rm("M", { current_cost_price: null })).cost).toBeNull();
    expect(usageLineCost(line({}), rm("M", { current_cost_price: 0 })).cost).toBe(0);
    const u = usageLineCost(line({}), rm("M", { cost_basis_status: "uverifisert" }));
    expect(u.cost).toBeNull();
    expect(u.note).toMatch(/Uverifisert/);
  });
  it("svinn som i computeRecipeCost", () => {
    expect(usageLineCost(line({ waste_percent: 10 }), rm("M", {})).cost).toBeCloseTo(54.54315 * 1.1, 6);
  });
  it("blandet enhet summeres riktig, ikke 900,1 g", () => {
    expect(sumQuantities([line({}), line({ quantity: 0.1, unit: "kg" })])).toEqual([{ amount: 1, unit: "kg" }]);
    expect(sumQuantities([line({}), line({ quantity: 2, unit: "stk" })])).toEqual([{ amount: 900, unit: "g" }, { amount: 2, unit: "stk" }]);
  });
  it("andel: kjent når alt er verifisert; ukjent med ufullstendig ingrediens eller halvfabrikat", () => {
    const materials = { M: rm("M", {}), A: rm("A", { current_cost_price: 10 }), B: rm("B", { current_cost_price: null }) };
    const ok = computeRecipeUsage({ selectedId: "M", allLines: [line({}), line({ raw_material_id: "A", quantity: 1000 })], materials, recipes, complete: true });
    expect(ok[0].costShare).toBeCloseTo(54.54315 / 64.54315, 6);
    const bad = computeRecipeUsage({ selectedId: "M", allLines: [line({}), line({ raw_material_id: "B" })], materials, recipes, complete: true });
    expect(bad[0].lineCost).toBeCloseTo(54.54315, 6);
    expect(bad[0].costShare).toBeNull();
    expect(bad[0].shareNote).toBe(SHARE_UNKNOWN);
    const sub = computeRecipeUsage({ selectedId: "M", allLines: [line({}), line({ raw_material_id: null, sub_product_id: "s1" })], materials, recipes, complete: true });
    expect(sub[0].costShare).toBeNull();
    const trunc = computeRecipeUsage({ selectedId: "M", allLines: [line({})], materials, recipes, complete: false });
    expect(trunc[0].costShare).toBeNull();
  });
});
