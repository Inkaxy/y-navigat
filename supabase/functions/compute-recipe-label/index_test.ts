// Deno-tester for de tre regeltunge punktene i compute-recipe-label:
// A) dekningsprosenten, B) glutenfri-sjekken, C) fullkorn av tørrstoff.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  computeDeclarationCore,
  dryMatterGrams,
  wholeGrainDryGrams,
  wholeGrainPctOfDry,
  type TopLine,
} from "../_shared/declaration-core.ts";
import { isGlutenFreeFromCodes, wholeGrainLimitFor } from "./keyhole.ts";

type Rows = Record<string, unknown[]>;

const MEL = "aaaaaaaa-0000-0000-0000-000000000001";
const VANN = "aaaaaaaa-0000-0000-0000-000000000003";

const FULL_NUTRITION = {
  energy_kj: 1450, energy_kcal: 345, fat_g: 1.2, saturated_fat_g: 0.2,
  carbs_g: 70, sugars_g: 1, fiber_g: 3, protein_g: 11, salt_g: 0,
};

function stub(tables: Rows): unknown {
  const query = (rows: unknown[]) => {
    const q = {
      select: () => q,
      in: () => Promise.resolve({ data: rows }),
      then: (fn: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: rows }).then(fn),
    };
    return q;
  };
  return { from: (t: string) => query(tables[t] ?? []) };
}

function line(over: Partial<TopLine> & { name: string }): TopLine {
  return {
    source: "master",
    raw_material: null,
    raw_material_id: null,
    quantity: 100,
    unit: "g",
    waste_percent: 0,
    include: true,
    is_quid: false,
    custom_text: null,
    unit_weight_grams: null,
    ...over,
  };
}

function baseTables(): Rows {
  return {
    raw_materials: [
      { id: MEL, name: "Hvetemel", declaration_name: "hvetemel", is_composite: false },
      { id: VANN, name: "Vann", declaration_name: "vann", is_composite: false },
    ],
    raw_material_nutrition: [{ raw_material_id: MEL, ...FULL_NUTRITION }],
    raw_material_allergens: [{ raw_material_id: MEL, allergen: "gluten_wheat", presence: "contains" }],
    raw_material_components: [],
  };
}

function doughLines(): TopLine[] {
  return [
    line({ name: "Hvetemel", raw_material_id: MEL, raw_material: { id: MEL }, quantity: 1000 }),
    line({ name: "Vann", raw_material_id: VANN, raw_material: { id: VANN }, quantity: 600 }),
  ];
}

/* A — teller og nevner må følge samme vannregel. */

Deno.test("A: mel 1000 g + vann 600 g, ferdigvekt 1030 g → 100 % dekning", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), doughLines(), { finalWeightGrams: 1030 });
  assertEquals(res.coverage_pct, 100);
});

Deno.test("A: samme deig med ferdigvekt 1400 g → 100 % dekning", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), doughLines(), { finalWeightGrams: 1400 });
  assertEquals(res.coverage_pct, 100);
});

/* B — glutenfri avgjøres av allergenkodene, ikke av etikettekstene. */

Deno.test("B: hvetebrød er ikke glutenfritt og får 30 %-kravet", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), doughLines(), { finalWeightGrams: 1030 });
  assertEquals(res.containsCodes.includes("gluten_wheat"), true);
  // De norske etikettekstene inneholder aldri ordet «gluten».
  assertEquals(res.containsList.some((a) => a.toLowerCase().includes("gluten")), false);
  const glutenFree = isGlutenFreeFromCodes(res.containsCodes);
  assertEquals(glutenFree, false);
  assertEquals(wholeGrainLimitFor("8a", glutenFree, 30), 30);
});

Deno.test("B: uten glutenkoder gjelder det lavere glutenfri-kravet", () => {
  assertEquals(isGlutenFreeFromCodes(["milk", "eggs"]), true);
  assertEquals(wholeGrainLimitFor("8a", true, 30), 10);
  assertEquals(wholeGrainLimitFor("8b", true, 35), 15);
  assertEquals(wholeGrainLimitFor("9", true, 50), 15);
});

/* C — fullkorn regnes av tørrstoff, uten manuell × 0,85. */

Deno.test("C: veilederen eksempel 3 → 58,6 %", () => {
  const entries = [
    { name: "Sammalt hvete", effective_grams: 119_000, water_content_pct: null, grain_classification: "whole_grain_flour" },
    { name: "Hvetemel", effective_grams: 84_000, water_content_pct: null, grain_classification: "sifted_flour" },
  ];
  assertEquals(wholeGrainPctOfDry(wholeGrainDryGrams(entries), dryMatterGrams(entries)), 58.6);
});

Deno.test("C: veilederen eksempel 4 → 45,0 %", () => {
  const entries = [
    { name: "Sammalt rug", effective_grams: 60, water_content_pct: null, grain_classification: "whole_grain_flour" },
    { name: "Poteter", effective_grams: 260, water_content_pct: 76, grain_classification: null },
  ];
  assertEquals(wholeGrainPctOfDry(wholeGrainDryGrams(entries), dryMatterGrams(entries)), 45);
});

Deno.test("C: veilederen eksempel 5 → 30,8 %", () => {
  const entries = [
    { name: "Sammalt rug", effective_grams: 40, water_content_pct: null, grain_classification: "whole_grain_flour" },
    { name: "Surdeig", effective_grams: 170, water_content_pct: 55, grain_classification: null },
  ];
  assertEquals(wholeGrainPctOfDry(wholeGrainDryGrams(entries), dryMatterGrams(entries)), 30.8);
});
