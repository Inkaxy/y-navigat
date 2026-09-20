import { describe, expect, it } from "vitest";
import {
  buildRecipeBasis,
  type LinkedRecipe,
  type ProductRecipeLinkRow,
} from "@/varer/hooks/useProductRecipeLink";
import {
  approvedDeclarationNeedsReview,
  recipeChangedSinceConfirm,
} from "@/varer/lib/recipeLinkBasis";
import type { BakersRawMaterial } from "@/varer/lib/bakers";

// Syntetiske testdata — ingen ekte varer eller oppskrifter berøres.
const rmMap: Record<string, BakersRawMaterial> = {
  mel: {
    id: "mel",
    name: "Hvetemel",
    grain_classification: "wheat",
    base_unit: "kg",
    current_cost_price: 12,
  },
  vann: { id: "vann", name: "Vann", base_unit: "kg", current_cost_price: 0, is_water: true },
  // Underoppskrift: registrert som råvare produsert av en annen oppskrift.
  surdeig: {
    id: "surdeig",
    name: "Surdeig (halvfabrikat)",
    base_unit: "kg",
    current_cost_price: 20,
    produced_by_recipe_id: "recipe-surdeig",
  },
  uprisetRm: { id: "uprisetRm", name: "Smør", base_unit: "kg", current_cost_price: null },
};

function recipe(overrides: Partial<LinkedRecipe> = {}): LinkedRecipe {
  return {
    id: "recipe-boller",
    name: "Hveteboller",
    status: "active",
    version: 3,
    category: "Bolle",
    department: null,
    units_per_batch: 40,
    unit_weight_grams: null,
    dough_piece_grams: 90,
    dough_waste_pct: 0,
    yield_quantity: null,
    yield_unit: null,
    yield_grams: null,
    yield_loss_pct: 0,
    finished_weight_grams: null,
    production_notes: "Elt 8 min",
    notes: null,
    description: null,
    shelf_life_days: 2,
    storage_instructions: null,
    bake_temp_celsius: 210,
    bake_time_minutes: 12,
    steam_seconds: null,
    cooling_minutes: null,
    bulk_proof_minutes: null,
    shape_proof_minutes: null,
    target_dough_temp_celsius: null,
    declaration_mode: null,
    updated_at: "2026-09-01T10:00:00.000Z",
    recipe_lines: [
      { id: "l1", recipe_part_id: "p1", raw_material_id: "mel", quantity: 2000, unit: "g" },
      { id: "l2", recipe_part_id: "p1", raw_material_id: "vann", quantity: 1200, unit: "g" },
      { id: "l3", recipe_part_id: "p1", raw_material_id: "surdeig", quantity: 400, unit: "g" },
    ],
    ...overrides,
  };
}

const flerpakkLink: ProductRecipeLinkRow = {
  id: "link-1",
  recipe_id: "recipe-boller",
  sales_unit_basis: "flerpakk",
  units_per_sales_unit: 8,
  sales_unit_confirmed_at: "2026-09-02T08:00:00.000Z",
};

describe("buildRecipeBasis", () => {
  it("regner kostnad og vekt per pakke for «Hveteboller 8PK»", () => {
    const b = buildRecipeBasis(flerpakkLink, recipe(), rmMap);
    // 2 kg mel à 12 = 24, vann 0, 0,4 kg surdeig à 20 = 8 → 32 kr for 40 emner
    expect(b.cost?.incomplete).toBe(false);
    expect(b.cost?.totalCost).toBeCloseTo(32);
    expect(b.unitCount).toBe(40);
    expect(b.basis.costPerUnit).toBeCloseTo(0.8);
    expect(b.basis.costPerSalesUnit).toBeCloseTo(6.4);
    expect(b.basis.weightPerSalesUnitG).toBeCloseTo(720);
    expect(b.basis.missing).toEqual([]);
  });

  it("teller underoppskriften én gang, via halvfabrikatets kostpris", () => {
    const b = buildRecipeBasis(flerpakkLink, recipe(), rmMap);
    const subLines = b.lines.filter((l) => l._rm?.produced_by_recipe_id);
    expect(subLines).toHaveLength(1);
    // Ingen dobbelttelling: totalen er summen av de tre linjene, ikke mer.
    expect(b.cost?.totalCost).toBeCloseTo(24 + 0 + 8);
  });

  it("stopper kostnadsberegningen når en råvare mangler pris", () => {
    const r = recipe({
      recipe_lines: [
        { id: "l1", recipe_part_id: "p1", raw_material_id: "mel", quantity: 2000, unit: "g" },
        { id: "l4", recipe_part_id: "p1", raw_material_id: "uprisetRm", quantity: 200, unit: "g" },
      ],
    });
    const b = buildRecipeBasis(flerpakkLink, r, rmMap);
    expect(b.cost?.incomplete).toBe(true);
    expect(b.basis.costPerSalesUnit).toBeNull();
    expect(b.basis.missing.join(" ")).toContain("ufullstendig");
  });

  it("melder manglende utbytte i stedet for å gjette antall emner", () => {
    const r = recipe({ units_per_batch: null, dough_piece_grams: null, unit_weight_grams: null });
    const b = buildRecipeBasis(flerpakkLink, r, rmMap);
    expect(b.unitCount).toBeNull();
    expect(b.basis.costPerSalesUnit).toBeNull();
    expect(b.basis.missing.join(" ")).toContain("antall emner");
  });

  it("gir ingen beregning uten kobling", () => {
    const b = buildRecipeBasis(null, null, rmMap);
    expect(b.recipe).toBeNull();
    expect(b.basis.costPerSalesUnit).toBeNull();
  });

  it("respekterer koblingens overstyrte utbytte uten å endre oppskriften", () => {
    const b = buildRecipeBasis(
      { ...flerpakkLink, units_per_batch_override: 32 },
      recipe(),
      rmMap,
    );
    expect(b.unitCount).toBe(40); // oppskriften selv er uendret
    expect(b.basis.unitsPerBatch).toBe(32);
    expect(b.basis.costPerUnit).toBeCloseTo(1);
  });
});

describe("endringer etter bekreftelse", () => {
  it("varsler når oppskriften er endret etter siste bekreftelse", () => {
    expect(
      recipeChangedSinceConfirm("2026-09-05T10:00:00.000Z", "2026-09-02T08:00:00.000Z"),
    ).toBe(true);
    expect(
      recipeChangedSinceConfirm("2026-09-01T10:00:00.000Z", "2026-09-02T08:00:00.000Z"),
    ).toBe(false);
  });

  it("markerer godkjent deklarasjon for ny gjennomgang, men beholder den", () => {
    expect(
      approvedDeclarationNeedsReview("2026-09-05T10:00:00.000Z", "2026-09-03T10:00:00.000Z"),
    ).toBe(true);
    // Uten godkjenning er det ingenting å gjennomgå.
    expect(approvedDeclarationNeedsReview("2026-09-05T10:00:00.000Z", null)).toBe(false);
  });
});
