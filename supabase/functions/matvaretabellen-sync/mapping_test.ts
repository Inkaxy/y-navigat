import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildConstituents, mapFood, pick, GENERATED_COLUMNS } from "./mapping.ts";

Deno.test("konstituent uten numerisk quantity hoppes over", () => {
  const out = buildConstituents([
    { nutrientId: "Vit E", sourceId: "10" },
    { nutrientId: "Fett", quantity: 1.5, unit: "g" },
  ], new Map());
  assertEquals(out, { Fett: { quantity: 1.5, unit: "g" } });
});

Deno.test("enhet hentes fra nutrients.json når konstituenten selv mangler den", () => {
  const out = buildConstituents([{ nutrientId: "Na", quantity: 3 }], new Map([["Na", "mg"]]));
  assertEquals(out, { Na: { quantity: 3, unit: "mg" } });
});

Deno.test("mapFood sender aldri de genererte kolonnene", () => {
  const row = mapFood(
    { foodId: "1", foodName: "Test", foodGroupId: "1", constituents: [] },
    new Map([["1", "Gruppe 1"]]),
    new Map(),
    "2026-01-01T00:00:00Z",
  ) as unknown as Record<string, unknown>;
  for (const col of GENERATED_COLUMNS) assertEquals(col in row, false);
  assertEquals(row.food_group_name, "Gruppe 1");
});

Deno.test("pick-felter plukkes riktig fra constituents", () => {
  const row = mapFood(
    {
      foodId: "1",
      foodName: "Test",
      constituents: [
        { nutrientId: "Enumet", quantity: 1, unit: "g" },
        { nutrientId: "Flerum", quantity: 2, unit: "g" },
        { nutrientId: "Trans", quantity: 0.1, unit: "g" },
        { nutrientId: "Na", quantity: 100, unit: "mg" },
        { nutrientId: "Sukker", quantity: 5, unit: "g" },
        { nutrientId: "Kolest", quantity: 10, unit: "mg" },
      ],
    },
    new Map(),
    new Map(),
    "2026-01-01T00:00:00Z",
  );
  assertEquals(row.mono_unsat_g, 1);
  assertEquals(row.poly_unsat_g, 2);
  assertEquals(row.trans_fat_g, 0.1);
  assertEquals(row.sodium_mg, 100);
  assertEquals(row.added_sugar_g, 5);
  assertEquals(row.cholesterol_mg, 10);
  assertEquals(pick({}, "Na"), null);
});
