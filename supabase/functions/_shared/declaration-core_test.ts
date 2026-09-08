import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  breadscaleCategory,
  computeBreadscale,
  computeDeclarationCore,
  declarationGate,
  dryMatterGrams,
  normalizeCereal,
  textComponentInheritance,
  wholeGrainPctOfDry,
  type TopLine,
} from "./declaration-core.ts";

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

/* ------------------------------------------------------------------ *
 * A–G: kritiske ingredienser, allergener, ferdigvekt, svinn og enheter
 * ------------------------------------------------------------------ */

type Rows = Record<string, unknown[]>;

/** Enkel stubb med samme kalleform som Supabase-klienten i kjernen. */
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

const MEL = "aaaaaaaa-0000-0000-0000-000000000001";
const SALT = "aaaaaaaa-0000-0000-0000-000000000002";
const VANN = "aaaaaaaa-0000-0000-0000-000000000003";

const FULL_NUTRITION = {
  energy_kj: 1450, energy_kcal: 345, fat_g: 1.2, saturated_fat_g: 0.2,
  carbs_g: 70, sugars_g: 1, fiber_g: 3, protein_g: 11, salt_g: 0,
};

function baseTables(extra: Partial<Rows> = {}): Rows {
  return {
    raw_materials: [
      { id: MEL, name: "Hvetemel", declaration_name: "hvetemel", is_composite: false },
      { id: SALT, name: "Salt, sekk", declaration_name: "salt", is_composite: false },
      { id: VANN, name: "Vann", declaration_name: "vann", is_composite: false },
    ],
    raw_material_nutrition: [{ raw_material_id: MEL, ...FULL_NUTRITION }],
    raw_material_allergens: [{ raw_material_id: MEL, allergen: "gluten_wheat", presence: "contains" }],
    raw_material_components: [],
    ...extra,
  };
}

Deno.test("A: salt uten næringsrad sperrer etiketten og vises aldri som 0", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), [
    line({ name: "Hvetemel", raw_material_id: MEL, raw_material: { id: MEL }, quantity: 1000 }),
    line({ name: "Salt, sekk", raw_material_id: SALT, raw_material: { id: SALT }, quantity: 20 }),
  ]);
  assertEquals(res.critical_missing_nutrition.some((n) => /salt/i.test(n)), true);
  const gate = declarationGate(res, 98);
  assertEquals(gate.blocked, true);
  assertStringIncludes(gate.reasons.join(" | ").toLowerCase(), "salt mangler næringsdata");
});

Deno.test("A: vann får nullrad og teller som dekket", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), [
    line({ name: "Hvetemel", raw_material_id: MEL, raw_material: { id: MEL }, quantity: 1000 }),
    line({ name: "Vann", raw_material_id: VANN, raw_material: { id: VANN }, quantity: 600 }),
  ]);
  assertEquals(res.critical_missing_nutrition.some((n) => /vann/i.test(n)), false);
  assertEquals(Math.round(res.coveredGrams), 1600);
});

Deno.test("B: fritekst-overstyring beholder råvarens allergen og uthever den", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), [
    line({
      name: "Hvetemel",
      raw_material_id: MEL,
      raw_material: { id: MEL },
      quantity: 1000,
      custom_text: "siktet hvetemel",
    }),
  ]);
  assertEquals(res.containsList.includes("hvete"), true);
  assertStringIncludes(res.ingredientHtml, "<strong>hvete</strong>");
  assertStringIncludes(res.ingredientText, "*hvete*");
});

Deno.test("B: include_in_declaration = false beholder allergenet i «Inneholder»", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), [
    line({ name: "Vann", raw_material_id: VANN, raw_material: { id: VANN }, quantity: 500 }),
    line({ name: "Hvetemel", raw_material_id: MEL, raw_material: { id: MEL }, quantity: 100, include: false }),
  ]);
  assertEquals(res.containsList.includes("hvete"), true);
  assertEquals(res.ingredientHtml.includes("hvetemel"), false);
});

Deno.test("E: vann under 5 % av ferdigvekten utelates fra listen", async () => {
  const res = await computeDeclarationCore(
    stub(baseTables()),
    [
      line({ name: "Hvetemel", raw_material_id: MEL, raw_material: { id: MEL }, quantity: 1000 }),
      line({ name: "Vann", raw_material_id: VANN, raw_material: { id: VANN }, quantity: 600 }),
    ],
    { finalWeightGrams: 1030 },
  );
  // Ferdigvekt 1030 − 1000 g mel = 30 g vann ≈ 2,9 % ⇒ utelates.
  assertEquals(res.ingredientHtml.toLowerCase().includes("vann"), false);
});

Deno.test("E: vann over 5 % av ferdigvekten tas med etter ferdig mengde", async () => {
  const res = await computeDeclarationCore(
    stub(baseTables()),
    [
      line({ name: "Hvetemel", raw_material_id: MEL, raw_material: { id: MEL }, quantity: 1000 }),
      line({ name: "Vann", raw_material_id: VANN, raw_material: { id: VANN }, quantity: 600 }),
    ],
    { finalWeightGrams: 1400 },
  );
  assertEquals(res.ingredientHtml.toLowerCase().includes("vann"), true);
});

Deno.test("G: svinn er EKSTRA innveid — deklarasjonen bruker g / (1 + w/100)", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), [
    line({ name: "Hvetemel", raw_material_id: MEL, raw_material: { id: MEL }, quantity: 110, waste_percent: 10 }),
  ]);
  assertEquals(Math.round(res.totalInputGrams), 100);
});

Deno.test("G: ukjent enhet gir sperre — aldri stille 0 g", async () => {
  const res = await computeDeclarationCore(stub(baseTables()), [
    line({ name: "Hvetemel", raw_material_id: MEL, raw_material: { id: MEL }, quantity: 1000 }),
    line({ name: "Krydderblanding", quantity: 2, unit: "never-heard-of" }),
  ]);
  assertEquals(res.unit_problems.length >= 1, true);
  assertEquals(declarationGate(res, 100).blocked, true);
});

/* ------------------------------------------------------------------ *
 * Brødskala'n (BKLF) og Nøkkelhullets fullkornteller
 * ------------------------------------------------------------------ */

function bs(
  name: string,
  effective_grams: number,
  grain_classification: string | null,
  cereal_type: string | null = null,
  custom_text: string | null = null,
) {
  return { name, effective_grams, grain_classification, cereal_type, custom_text };
}

Deno.test("A: 300 siktet + 200 sammalt + 50 hvetekli = 425/550 = 77,3 % ekstra grovt", () => {
  const r = computeBreadscale([
    bs("Hvetemel", 300, "sifted_flour", "hvete"),
    bs("Sammalt hvete", 200, "whole_grain_flour", "hvete"),
    bs("Hvetekli", 50, "wheat_bran"),
  ]);
  assertEquals(r.total_flour_grams, 550);
  assertEquals(r.coarse_grams_weighted, 425);
  assertEquals(r.breadscale_pct, 77.3);
  assertEquals(r.grain_category, "ekstra_grovt");
});

Deno.test("A: prosenten kan overstige 100 — kolonnen får min(100, pct)", () => {
  const r = computeBreadscale([
    bs("Sammalt", 450, "whole_grain_flour", "hvete"),
    bs("Hele korn", 50, "whole_grains", "hvete"),
    bs("Hvetekli", 50, "wheat_bran"),
  ]);
  assertEquals(r.breadscale_pct, 131.8);
  assertEquals(r.grain_pct, 100);
  assertEquals(r.breadscale_pct_display, "131,8 %");
});

Deno.test("A: kli teller UVEKTET i nevneren — 1000 siktet + 116 hvetekli = 46,8 % halvgrovt", () => {
  const r = computeBreadscale([
    bs("Hvetemel", 1000, "sifted_flour", "hvete"),
    bs("Hvetekli", 116, "wheat_bran"),
  ]);
  assertEquals(r.breadscale_pct, 46.8);
  assertEquals(r.grain_category, "halvgrovt");
});

Deno.test("A: klifaktorene er 4,5 / 4,0 / 2,0", () => {
  assertEquals(computeBreadscale([bs("Rugkli", 100, "rye_bran")]).coarse_grams_weighted, 400);
  assertEquals(computeBreadscale([bs("Havrekli", 100, "oat_bran")]).coarse_grams_weighted, 200);
  assertEquals(computeBreadscale([bs("Hvetekli", 100, "wheat_bran")]).coarse_grams_weighted, 450);
});

Deno.test("A: frø, nøtter, vann, salt, gjær, fett og malt påvirker ikke grovheten", () => {
  const base = [bs("Hvetemel", 500, "sifted_flour", "hvete"), bs("Sammalt", 500, "whole_grain_flour", "hvete")];
  const extra = [
    bs("Solsikkefrø", 100, "not_grain"),
    bs("Vann", 600, "not_grain"),
    bs("Salt", 20, "not_grain"),
    bs("Gjær", 30, "not_grain"),
    bs("Smør", 50, "not_grain"),
    bs("Maltmel", 10, "malt_or_improver"),
  ];
  assertEquals(computeBreadscale([...base, ...extra]).breadscale_pct, 50);
});

Deno.test("D: gluten og kim teller som siktet i nevneren", () => {
  const r = computeBreadscale([
    bs("Sammalt", 500, "whole_grain_flour", "hvete"),
    bs("Hvetegluten", 500, "gluten_or_germ"),
  ]);
  assertEquals(r.breadscale_pct, 50);
  assertEquals(r.whole_grain_grams, 500);
});

Deno.test("A: trinngrensene 25,9/26,0, 50,9/51,0 og 75,9/76,0", () => {
  assertEquals(breadscaleCategory(25.9), "fint");
  assertEquals(breadscaleCategory(26.0), "halvgrovt");
  assertEquals(breadscaleCategory(50.9), "halvgrovt");
  assertEquals(breadscaleCategory(51.0), "grovt");
  assertEquals(breadscaleCategory(75.9), "grovt");
  assertEquals(breadscaleCategory(76.0), "ekstra_grovt");
});

Deno.test("A: 25,95 % rundes til 26,0 og blir halvgrovt — ett avrundingssted", () => {
  // 259,5 g vektet av 1000 g mel ⇒ 25,95 %
  const r = computeBreadscale([
    bs("Hvetemel", 942, "sifted_flour", "hvete"),
    bs("Hvetekli", 58, "wheat_bran"),
  ]);
  assertEquals(r.breadscale_pct, 26.1);
  assertEquals(r.grain_category, "halvgrovt");
  assertEquals(breadscaleCategory(Math.round(25.95 * 10) / 10), "halvgrovt");
});

Deno.test("B: kli gir ikke fullkorn til Nøkkelhullet", () => {
  const r = computeBreadscale([
    bs("Hvetemel", 1000, "sifted_flour", "hvete"),
    bs("Hvetekli", 116, "wheat_bran"),
  ]);
  assertEquals(r.whole_grain_grams, 0);
});

Deno.test("B: veilederen eksempel 3 — 119 kg fullkorn + 84 kg annet tørt = 59 %", () => {
  const whole = 119_000;
  const dry = dryMatterGrams([
    { name: "Sammalt hvete", effective_grams: 119_000, water_content_pct: null },
    { name: "Hvetemel", effective_grams: 84_000, water_content_pct: null },
  ]);
  assertEquals(wholeGrainPctOfDry(whole * 0.85, dry), 58.6);
});

Deno.test("B: eksempel 4 — poteter med TS 0,24 regnes med faktisk tørrstoff", () => {
  const dry = dryMatterGrams([
    { name: "Sammalt rug", effective_grams: 60, water_content_pct: null },
    { name: "Poteter", effective_grams: 260, water_content_pct: 76 },
  ]);
  assertEquals(Math.round(dry * 10) / 10, 113.4);
  assertEquals(wholeGrainPctOfDry(60 * 0.85, dry), 45);
});

Deno.test("B: eksempel 5 — surdeig med TS 0,45", () => {
  const dry = dryMatterGrams([
    { name: "Sammalt rug", effective_grams: 40, water_content_pct: null },
    { name: "Surdeig", effective_grams: 170, water_content_pct: 55 },
  ]);
  assertEquals(wholeGrainPctOfDry(40 * 0.85, dry), 30.8);
});

Deno.test("B: flytende olje og sirup holdes utenfor tørrstoffet", () => {
  const dry = dryMatterGrams([
    { name: "Sammalt hvete", effective_grams: 100, water_content_pct: null },
    { name: "Rapsolje", effective_grams: 50, water_content_pct: null },
    { name: "Sirup", effective_grams: 50, water_content_pct: null },
  ]);
  assertEquals(dry, 85);
});

Deno.test("B: rugandel bruker samme nevner som grovheten", () => {
  const r = computeBreadscale([
    bs("Sammalt rug", 400, "whole_grain_flour", "rug"),
    bs("Hvetemel", 600, "sifted_flour", "hvete"),
  ]);
  assertEquals(r.rye_flour_grams / r.total_flour_grams >= 0.3, true);
});

Deno.test("D: emmer og einkorn regnes som spelt/hvete", () => {
  assertEquals(normalizeCereal("emmer"), "spelt");
  assertEquals(normalizeCereal("einkorn"), "hvete");
  assertEquals(normalizeCereal("Rug"), "rug");
});

Deno.test("E: fritekstlinje med kornord over 5 g blokkerer merket", () => {
  const r = computeBreadscale([
    bs("Hvetemel", 1000, "sifted_flour", "hvete"),
    bs("Hvetegr.", 79_000, null, null, "Hvetegr."),
  ]);
  assertEquals(r.free_text_grain_lines.length, 1);
  assertEquals(r.free_text_grain_lines[0].grams, 79_000);
});
