import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { computeDeclarationCore, textComponentInheritance, type TopLine } from "./declaration-core.ts";

Deno.test("tekstkomponenten arver næring, men IKKE allergenparentesen", () => {
  const res = textComponentInheritance(true, ["milk"], ["nuts_hazelnut"], []);
  assertEquals(res.has_nutrition, true);
  assertEquals(res.allergens, []);
  assertEquals(res.inherited_allergens, ["milk"]);
  assertEquals(res.inherited_may_allergens, ["nuts_hazelnut"]);
});

Deno.test("komponentens egne allergener står på linjen, forelderens arves", () => {
  const res = textComponentInheritance(false, ["milk"], ["milk", "soybeans"], ["soybeans"]);
  assertEquals(res.has_nutrition, false);
  assertEquals(res.allergens, ["soybeans"]);
  assertEquals(res.inherited_allergens, ["milk"]);
  assertEquals(res.inherited_may_allergens, []);
});

/* ------------------------------------------------------------------ *
 * Hele kjernen med stubbet database
 * ------------------------------------------------------------------ */

const PARENT = "11111111-1111-1111-1111-111111111111";
const CHILD = "22222222-2222-2222-2222-222222222222";

function stubService(): unknown {
  const tables: Record<string, unknown[]> = {
    raw_material_components: [
      {
        id: "c1",
        parent_raw_material_id: PARENT,
        component_raw_material_id: CHILD,
        primary_ingredient_name: null,
        percentage: 40,
        sort_order: 1,
        allergens: [],
        is_quid_relevant: false,
      },
      {
        id: "c2",
        parent_raw_material_id: PARENT,
        component_raw_material_id: null,
        primary_ingredient_name: "sukker",
        percentage: 60,
        sort_order: 2,
        allergens: [],
        is_quid_relevant: false,
      },
    ],
    raw_materials: [
      { id: PARENT, name: "Fyll", declaration_name: "fyll", is_composite: true },
      { id: CHILD, name: "Hvetemel", declaration_name: "hvetemel", is_composite: false },
    ],
    raw_material_nutrition: [
      { raw_material_id: PARENT, energy_kcal: 400, fat_g: 10 },
      { raw_material_id: CHILD, energy_kcal: 340, fat_g: 1 },
    ],
    raw_material_allergens: [
      { raw_material_id: PARENT, allergen: "milk", presence: "contains" },
      { raw_material_id: PARENT, allergen: "soybeans", presence: "contains" },
      { raw_material_id: CHILD, allergen: "gluten_wheat", presence: "contains" },
    ],
  };

  const query = (rows: unknown[]) => {
    const q = {
      select: () => q,
      in: (_col: string, _vals: string[]) => Promise.resolve({ data: rows }),
      then: (fn: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: rows }).then(fn),
    };
    return q;
  };

  return { from: (table: string) => query(tables[table] ?? []) };
}

Deno.test("sammensatt råvare: tekstkomponent uten allergenparentes, men med i «Inneholder»", async () => {
  const topLines: TopLine[] = [
    {
      source: "master",
      raw_material: { id: PARENT, is_composite: true },
      raw_material_id: PARENT,
      name: "Fyll",
      quantity: 1000,
      unit: "g",
      waste_percent: 0,
      include: true,
      is_quid: false,
      custom_text: null,
      unit_weight_grams: null,
    },
  ];

  const res = await computeDeclarationCore(stubService(), topLines);

  assertStringIncludes(res.ingredientHtml, "sukker");
  // Ingen arvede allergener i parentes på tekstkomponenten.
  assertEquals(res.ingredientHtml.includes("sukker (melk"), false);
  assertEquals(/sukker\s*\(/.test(res.ingredientHtml), false);
  // «Inneholder» er likevel komplett.
  assertEquals(res.containsList.includes("melk"), true);
  assertEquals(res.containsList.includes("soya"), true);
  // Tekstandelen får forelderens næring forholdsmessig (600 g av 400 kcal/100 g).
  assertEquals(Math.round(res.nutritionTotals.energy_kcal ?? 0), Math.round(600 * 4 + 400 * 3.4));
});
