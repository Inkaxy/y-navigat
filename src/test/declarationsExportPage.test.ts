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
      declaration_review_reason: null as string | null, declaration_version_id: "v1" as string | null, updated_at: "2026-10-01T10:00:00Z",
      show_breadscale: true as boolean | null, breadscale_pct: 60 as number | null, breadscale_mode: "auto",
      breadscale_manual_value: null as number | null,
    }],
    product_recipe_links: [{ id: "l1", product_id: "p1", recipe_id: "r1", is_primary: true, created_at: "2026-09-01T10:00:00.123456+00:00" as string | null }],
    recipes: [{ id: "r1", name: "Kneipp", unit_weight_grams: 500, shelf_life_days: 3, storage_instructions: "Tørt",
      country_of_origin: "Norge", breadscale_mode: "manual", manual_breadscale_pct: 60 as number | null,
      label_claim_grain: true as boolean | null }],
    recipe_label_calculated: [{ recipe_id: "r1", computed_at: "2026-10-01T09:00:00Z", is_stale: false,
      grain_category: "grovt", grain_score_pct: 60 }],
    recipe_declaration_versions: [{
      id: "v1", version: 1, source: "calculated", approved_at: "2026-10-01T10:00:00Z",
      ingredient_text: "Hvetemel (hvete), vann", ingredient_html: "Hvetemel (<strong>hvete</strong>), vann",
      allergens_contains: ["hvete"], allergens_may_contain: [], nutrition_per_100g: { energy_kj: 1000 },
      net_weight_g: 500, shelf_life_days: 3, storage_text: "Tørt", origin_text: "Norge",
      claim_grain: true as boolean | null, claim_keyhole: false, breadscale_pct: 60 as number | null,
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

/** Første (eneste) vare på siden. */
async function only(w: ReturnType<typeof world>): Promise<Row> {
  const r = await buildDeclarationsPage(fakeDb(w), input);
  if (!r.ok) throw new Error("forventet ok");
  expect(r.products).toHaveLength(1);
  return r.products[0];
}

describe("declarations-export: grovhet bare når merket er godkjent (beslutning 2, 12.11.2026)", () => {
  it("godkjent versjon + show_breadscale + claim_grain gir grain", async () => {
    expect((await only(world())).grain).toMatchObject({ level: "grovt", pct: 60, pieces: 3, pieces_total: 4 });
  });

  it("varen viser ikke merket (show_breadscale av/null) → grain null", async () => {
    const off = world();
    off.products[0].show_breadscale = false;
    expect((await only(off)).grain).toBeNull();
    const unknown = world();
    unknown.products[0].show_breadscale = null;
    expect((await only(unknown)).grain).toBeNull();
  });

  it("versjonen har ikke godkjent merket eller mangler prosent → grain null", async () => {
    const noClaim = world();
    noClaim.recipe_declaration_versions[0].claim_grain = false;
    expect((await only(noClaim)).grain).toBeNull();
    const noPct = world();
    noPct.recipe_declaration_versions[0].breadscale_pct = null;
    expect((await only(noPct)).grain).toBeNull();
  });

  it("content_hash endres når grain forsvinner, ellers ikke", async () => {
    const a = await only(world());
    const b = await only(world());
    expect(b.content_hash).toBe(a.content_hash);
    const off = world();
    off.products[0].show_breadscale = false;
    expect((await only(off)).content_hash).not.toBe(a.content_hash);
  });

  it("prosenten sendes som helt tall rundet ned; nivået følger uavrundet prosent", async () => {
    const cases: Array<[number, string, number]> = [
      [25.9, "fint", 25], [26, "halvgrovt", 26], [25.6, "fint", 25], [26.4, "halvgrovt", 26],
      [50.9, "halvgrovt", 50], [51, "grovt", 51], [75.9, "grovt", 75], [76, "ekstra_grovt", 76],
    ];
    for (const [pct, level, shown] of cases) {
      const w = world();
      w.recipe_declaration_versions[0].breadscale_pct = pct;
      expect((await only(w)).grain).toMatchObject({ level, pct: shown });
    }
  });

  function legacy(): ReturnType<typeof world> {
    const w = world();
    w.products[0].declaration_version_id = null;
    w.recipe_declaration_versions = [];
    return w;
  }

  it("legacy: oppskriftens merkevalg + fersk beregning gir grain fra oppskriften", async () => {
    const w = legacy();
    w.recipes[0].breadscale_mode = "auto";
    expect((await only(w)).grain).toMatchObject({ level: "grovt", pct: 60, source: "auto" });
  });

  it("legacy: uten show_breadscale, uten produktprosent eller uten merkevalg → grain null", async () => {
    const off = legacy();
    off.products[0].show_breadscale = false;
    expect((await only(off)).grain).toBeNull();
    const noPct = legacy();
    noPct.products[0].breadscale_pct = null;
    expect((await only(noPct)).grain).toBeNull();
    const noClaim = legacy();
    noClaim.recipes[0].label_claim_grain = false;
    expect((await only(noClaim)).grain).toBeNull();
  });

  it("legacy: utdatert beregning teller ikke i automatisk modus", async () => {
    const w = legacy();
    w.recipes[0].breadscale_mode = "auto";
    w.recipe_label_calculated[0] = { ...w.recipe_label_calculated[0], is_stale: true };
    expect((await only(w)).grain).toBeNull();
  });

  it("legacy: manuell prosent på varen godkjenner merket selv uten oppskriftens merkevalg", async () => {
    const w = legacy();
    w.recipes[0].label_claim_grain = false;
    w.products[0].breadscale_mode = "manual";
    w.products[0].breadscale_manual_value = 60;
    expect((await only(w)).grain).toMatchObject({ level: "grovt", pct: 60 });
  });

  it("legacy: kan effektiv oppskrift ikke avgjøres sikkert → grain null", async () => {
    const w = legacy();
    // To ikke-primære koblinger, én uten created_at: product_effective_recipe_id kan ikke gjenskapes.
    w.product_recipe_links = [
      { id: "l1", product_id: "p1", recipe_id: "r1", is_primary: false, created_at: "2026-09-01T10:00:00.123456+00:00" },
      { id: "l2", product_id: "p1", recipe_id: "r2", is_primary: false, created_at: null },
    ];
    expect((await only(w)).grain).toBeNull();
  });

  it("legacy: eksportens oppskrift er ikke den effektive → grain null (ingen gjetning)", async () => {
    const w = legacy();
    w.recipes[0].breadscale_mode = "auto";
    // Nyeste kobling kommer først: eksporten bruker r1, men effektiv (eldste) er r2.
    w.product_recipe_links = [
      { id: "l1", product_id: "p1", recipe_id: "r1", is_primary: false, created_at: "2026-09-02T10:00:00.000001+00:00" },
      { id: "l2", product_id: "p1", recipe_id: "r2", is_primary: false, created_at: "2026-09-02T10:00:00+00:00" },
    ];
    expect((await only(w)).grain).toBeNull();
    // Samme rekkefølge, men r1 er eldst på mikrosekund → effektiv = r1 → grain.
    w.product_recipe_links[1].created_at = "2026-09-02T10:00:00.000002+00:00";
    expect((await only(w)).grain).toMatchObject({ level: "grovt", pct: 60 });
  });
});
