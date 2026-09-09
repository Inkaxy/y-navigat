// Deno-tester for utbretting av halvfabrikater i oppskriftslinjer.
// Databasen er stubbet, slik at reglene kan testes uten Supabase.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { expandRecipeLines, MAX_SUB_DEPTH } from "./recipe-lines.ts";

const SUB_RECIPE = "bbbbbbbb-0000-0000-0000-000000000001";
const TOP_RECIPE = "bbbbbbbb-0000-0000-0000-000000000002";
const SURDEIG = "cccccccc-0000-0000-0000-000000000001";
const MEL = "cccccccc-0000-0000-0000-000000000002";
const VANN = "cccccccc-0000-0000-0000-000000000003";

type Rows = Record<string, unknown[]>;

/**
 * Stubber kalleformene `expandRecipeLines` bruker:
 *   recipe_lines: .select().eq().order()
 *   recipes:      .select().eq().maybeSingle()
 *   product_recipe_links: .select().eq().order().limit().maybeSingle()
 */
function stub(tables: Rows): unknown {
  const query = (rows: unknown[]) => {
    let current = rows;
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        current = current.filter((r) => (r as Record<string, unknown>)[col] === val);
        return q;
      },
      order: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve({ data: current[0] ?? null }),
      then: (fn: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: current }).then(fn),
    };
    return q;
  };
  return { from: (t: string) => query([...(tables[t] ?? [])]) };
}

function rmLine(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    raw_material_id: null,
    sub_product_id: null,
    ingredient_name: null,
    quantity: 100,
    unit: "g",
    waste_percent: 0,
    include_in_declaration: true,
    is_quid_relevant: false,
    custom_declaration_text: null,
    water_content_pct_override: null,
    sort_order: 1,
    raw_materials: null,
    ...over,
  };
}

function tables(): Rows {
  return {
    recipe_lines: [
      rmLine({
        recipe_id: TOP_RECIPE,
        raw_material_id: SURDEIG,
        quantity: 300,
        sort_order: 1,
        raw_materials: { id: SURDEIG, name: "Surdeig", produced_by_recipe_id: SUB_RECIPE },
      }),
      rmLine({
        recipe_id: SUB_RECIPE,
        raw_material_id: MEL,
        quantity: 100,
        sort_order: 1,
        raw_materials: { id: MEL, name: "Hvetemel" },
      }),
      rmLine({
        recipe_id: SUB_RECIPE,
        raw_material_id: VANN,
        quantity: 100,
        sort_order: 2,
        raw_materials: { id: VANN, name: "Vann" },
      }),
    ],
    recipes: [
      { id: SUB_RECIPE, name: "Surdeig", yield_grams: 200 },
      { id: TOP_RECIPE, name: "Brød", yield_grams: 1000 },
    ],
    product_recipe_links: [],
  };
}

Deno.test("produced_by_recipe_id bretter ut halvfabrikatet og skalerer 300/200", async () => {
  const warnings: string[] = [];
  const out = await expandRecipeLines(stub(tables()), TOP_RECIPE, 0, new Set([TOP_RECIPE]), warnings);

  assertEquals(warnings, []);
  assertEquals(out.length, 2);
  assertEquals(out.map((l) => l.name), ["Hvetemel", "Vann"]);
  // 300 g brukt av 200 g ferdigvekt ⇒ faktor 1,5.
  assertEquals(out.map((l) => l.quantity), [150, 150]);
  assertEquals(out.map((l) => l.unit), ["g", "g"]);
  assertEquals(out.map((l) => l.waste_percent), [0, 0]);
});

Deno.test("svinn på halvfabrikatlinjen regnes inn før skaleringen", async () => {
  const t = tables();
  (t.recipe_lines[0] as Record<string, unknown>).waste_percent = 50;
  const out = await expandRecipeLines(stub(t), TOP_RECIPE, 0, new Set([TOP_RECIPE]), []);
  // 300 g + 50 % svinn = 600 g behov ⇒ faktor 3.
  assertEquals(out.map((l) => l.quantity), [300, 300]);
});

Deno.test("halvfabrikat uten vekt gir advarsel og beholder linjen", async () => {
  const t = tables();
  (t.recipe_lines[1] as Record<string, unknown>).quantity = 0;
  (t.recipe_lines[2] as Record<string, unknown>).quantity = 0;
  t.recipes = [{ id: SUB_RECIPE, name: "Surdeig" }];
  const warnings: string[] = [];
  const out = await expandRecipeLines(stub(t), TOP_RECIPE, 0, new Set([TOP_RECIPE]), warnings);
  assertEquals(out.length, 1);
  assertEquals(out[0].name, "Surdeig");
  assertEquals(warnings.some((w) => w.includes("mangler vekt")), true);
});

Deno.test("ring i halvfabrikatene hoppes over med advarsel", async () => {
  const warnings: string[] = [];
  const out = await expandRecipeLines(
    stub(tables()),
    TOP_RECIPE,
    0,
    new Set([TOP_RECIPE, SUB_RECIPE]),
    warnings,
  );
  assertEquals(out.length, 1);
  assertEquals(out[0].name, "Surdeig");
  assertEquals(warnings.some((w) => w.includes("peker i ring")), true);
});

Deno.test("dybdegrensen stopper utbrettingen med advarsel", async () => {
  const warnings: string[] = [];
  const out = await expandRecipeLines(stub(tables()), TOP_RECIPE, MAX_SUB_DEPTH, new Set([TOP_RECIPE]), warnings);
  assertEquals(out.length, 1);
  assertEquals(warnings.some((w) => w.includes(`${MAX_SUB_DEPTH} nivåer`)), true);
});
