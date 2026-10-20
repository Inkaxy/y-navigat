import { describe, expect, it } from "vitest";
import { buildDeclarationsPage, type Db, type Query } from "../../supabase/functions/declarations-export/page";

type Row = Record<string, unknown>;

/** Falsk database: filtrerer kun på eq/in; øvrige kall kjedes. */
function fakeDb(tables: Record<string, Row[]>): Db {
  return {
    from(table: string): Query {
      const filters: Array<(r: Row) => boolean> = [];
      const run = () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
      const q: Query = {
        select: () => q,
        eq: (c, v) => (filters.push((r) => r[c] === v), q),
        neq: () => q,
        not: () => q,
        in: (c, v) => (filters.push((r) => v.includes(r[c])), q),
        or: () => q,
        order: () => q,
        range: () => q,
        maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
        then: (ok, err) => Promise.resolve(run()).then(ok, err),
      };
      return q;
    },
  };
}

const ENT = "ent-1";
function world() {
  return {
    products: [{
      id: "p1", legal_entity_id: ENT, display_number: 7, code: "K", display_name: "Kneipp", ean_code: null,
      unit_of_sale: "stk", in_web_shop: true, status: "active", weight_per_unit_grams: null as number | null, keywords: [],
      manual_ingredient_declaration: "Hvetemel (*hvete*), vann", manual_allergens_contains: ["hvete"],
      manual_allergens_may_contain: [], manual_nutrition_per_100g: { energy_kj: 1000 },
      manual_declaration_updated_at: "2026-10-01T10:00:00Z", declaration_needs_review: false,
      declaration_review_reason: null as string | null, declaration_version_id: "v1", updated_at: "2026-10-01T10:00:00Z",
    }],
    product_recipe_links: [{ product_id: "p1", recipe_id: "r1", is_primary: true }],
    recipes: [{ id: "r1", name: "Kneipp", unit_weight_grams: 500, shelf_life_days: 3, storage_instructions: "Tørt",
      country_of_origin: "Norge", breadscale_mode: "manual", manual_breadscale_pct: 60 }],
    recipe_label_calculated: [{ recipe_id: "r1", computed_at: "2026-10-01T09:00:00Z", is_stale: false,
      grain_category: "grovt", grain_score_pct: 60 }],
    recipe_declaration_versions: [{
      id: "v1", version: 1, source: "calculated", approved_at: "2026-10-01T10:00:00Z",
      ingredient_text: "Hvetemel (hvete), vann", ingredient_html: "Hvetemel (<strong>hvete</strong>), vann",
      allergens_contains: ["hvete"], allergens_may_contain: [], nutrition_per_100g: { energy_kj: 1000 },
      net_weight_g: 500, shelf_life_days: 3, storage_text: "Tørt", origin_text: "Norge",
      claim_grain: true, claim_keyhole: false, breadscale_pct: 60,
    }],
    legal_entities: [{ id: ENT, legal_name: "Nøtterø Bakeri" }],
  } satisfies Record<string, Row[]>;
}
const input = { legalEntityId: ENT, page: 1, pageSize: 50, updatedSince: null, productIds: [] };
const PUBLISHED = ["ingredient_text", "allergens_contains", "allergens_may_contain", "nutrition_per_100g",
  "net_weight_grams", "shelf_life_days", "storage_instructions", "country_of_origin", "grain", "approved_at", "content_hash"];
const pick = (r: Row) => Object.fromEntries(PUBLISHED.map((k) => [k, r[k]]));

describe("declarations-export endepunkt (falsk database)", () => {
  it("råvare-/beregnings-/oppskriftsendring endrer ikke publisert innhold eller hash", async () => {
    const before = await buildDeclarationsPage(fakeDb(world()), input);
    if (!before.ok) throw new Error("forventet ok");
    expect(before.products).toHaveLength(1);
    expect(before.products[0].ingredient_text).toBe("Hvetemel (*hvete*), vann");
    expect(before.products[0].grain).toMatchObject({ source: "auto", pct: 60 });

    const w = world();
    // Ny beregning/råvareendring + kladdendringer på oppskriften.
    w.products[0].manual_ingredient_declaration = "Hvetemel (*hvete*), vann, *sesam*";
    w.products[0].manual_allergens_contains = ["hvete", "sesam"];
    w.products[0].declaration_needs_review = true;
    w.products[0].declaration_review_reason = "raw_material_changed";
    w.recipe_label_calculated[0] = { ...w.recipe_label_calculated[0], is_stale: true, grain_score_pct: 20, grain_category: "fint" };
    Object.assign(w.recipes[0], { name: "Kneipp NY", unit_weight_grams: 750, breadscale_mode: "auto",
      manual_breadscale_pct: 10, shelf_life_days: 9, storage_instructions: "Kjøl" });

    const after = await buildDeclarationsPage(fakeDb(w), input);
    if (!after.ok) throw new Error("forventet ok");
    expect(after.products).toHaveLength(1);
    expect(pick(after.products[0])).toEqual(pick(before.products[0]));
    expect(after.products[0]).toMatchObject({ needs_review: true, declaration_source: "approved_version", recipe_name: "Kneipp NY" });
  });

  it("produktets egen vekt (variant) overstyrer godkjent vekt", async () => {
    const w = world();
    w.products[0].weight_per_unit_grams = 250;
    const r = await buildDeclarationsPage(fakeDb(w), input);
    if (!r.ok) throw new Error("forventet ok");
    expect(r.products[0].net_weight_grams).toBe(250);
  });

  it("peker til versjon som ikke kan lastes holdes ute, også uten review", async () => {
    const w = world();
    w.recipe_declaration_versions = [];
    const r = await buildDeclarationsPage(fakeDb(w), input);
    if (!r.ok) throw new Error("forventet ok");
    expect(r.products).toHaveLength(0);
  });
});
