import { assertEquals, assertNotEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildInputsHash, type HashLineInput, type HashMaterialFact, type HashYieldInput } from "./recipe-label-hash.ts";

const lines: HashLineInput[] = [
  {
    raw_material_id: "rm-1",
    sub_product_id: null,
    ingredient_name: "Hvetemel",
    grams: 1000,
    waste_percent: 0,
    include_in_declaration: true,
    custom_declaration_text: null,
  },
];

const yieldFields: HashYieldInput = {
  yield_grams: 1000,
  yield_loss_pct: 12,
  finished_weight_grams: 880,
  yield_quantity: 1,
  yield_unit: "stk",
};

const materials: HashMaterialFact[] = [
  {
    raw_material_id: "rm-1",
    declaration_name: "hvetemel",
    water_content_pct: 14,
    grain_classification: "sifted_flour",
    cereal_type: "hvete",
    unit_weight_grams: null,
    allergens: ["Gluten"],
    nutrition_updated_at: "2026-01-01T00:00:00Z",
  },
];

Deno.test("identisk input gir identisk hash", async () => {
  const a = await buildInputsHash(lines, yieldFields, materials);
  const b = await buildInputsHash(lines, yieldFields, materials);
  assertEquals(a, b);
});

Deno.test("rekkefølgen på råvarer og allergener påvirker ikke hashen", async () => {
  const materials2: HashMaterialFact[] = [
    { ...materials[0], allergens: ["Gluten"] },
  ];
  const a = await buildInputsHash(lines, yieldFields, materials);
  const b = await buildInputsHash(lines, yieldFields, [...materials2].reverse());
  assertEquals(a, b);
});

Deno.test("endret gram-mengde endrer hashen", async () => {
  const a = await buildInputsHash(lines, yieldFields, materials);
  const changedLines = [{ ...lines[0], grams: 1001 }];
  const b = await buildInputsHash(changedLines, yieldFields, materials);
  assertNotEquals(a, b);
});

Deno.test("endret updated_at på næringsraden endrer hashen", async () => {
  const a = await buildInputsHash(lines, yieldFields, materials);
  const changedMaterials = [{ ...materials[0], nutrition_updated_at: "2026-02-01T00:00:00Z" }];
  const b = await buildInputsHash(lines, yieldFields, changedMaterials);
  assertNotEquals(a, b);
});

Deno.test("endret yield-felt endrer hashen", async () => {
  const a = await buildInputsHash(lines, yieldFields, materials);
  const b = await buildInputsHash(lines, { ...yieldFields, yield_loss_pct: 13 }, materials);
  assertNotEquals(a, b);
});
