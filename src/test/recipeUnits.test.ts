import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeUnitCount,
  convertToGrams,
  fromGrams,
  normalizeRecipeUnit,
  resolveFinalWeight,
  toLitres,
} from "@/varer/lib/units-recipe";
import { computeTotalsForRecipe, type BakersLine } from "@/varer/lib/bakers";
import { computeRecipeCost, lineCost } from "@/varer/lib/recipeCost";
import { decideHydration } from "@/varer/lib/recipeEditorSync";
import { validateRecipeSave } from "@/varer/hooks/useRecipeSave";
import type { EditorLine, EditorPart } from "@/varer/components/recipes/RecipePartCard";

describe("enhetsmotoren er speilet", () => {
  it("frontend og edge har byte-identisk fil", () => {
    const a = readFileSync("src/varer/lib/units-recipe.ts");
    const b = readFileSync("supabase/functions/_shared/units-recipe.ts");
    expect(a.equals(b)).toBe(true);
  });
});

describe("convertToGrams", () => {
  it("regner 2 l melk til 2 000 g når tettheten er kjent", () => {
    const r = convertToGrams(2, "l", { densityGPerMl: 1 });
    expect(r.grams).toBe(2000);
    expect(r.exact).toBe(true);
  });

  it("gir ufullstendig svar for volum uten tetthet — aldri en stille nullvekt", () => {
    const r = convertToGrams(2, "l");
    expect(r.exact).toBe(false);
    expect(r.reason).toContain("tetthet");
  });

  it("håndterer alle kanoniske enheter og aliaser", () => {
    expect(convertToGrams(1, "kg").grams).toBe(1000);
    expect(convertToGrams(1, "Kilo").grams).toBe(1000);
    expect(convertToGrams(5, "dl", { densityGPerMl: 1 }).grams).toBe(500);
    expect(convertToGrams(5, "cl", { densityGPerMl: 1 }).grams).toBe(50);
    expect(convertToGrams(3, "stk", { pieceWeightG: 60 }).grams).toBe(180);
    expect(normalizeRecipeUnit("Liter")).toBe("l");
    expect(normalizeRecipeUnit("tsk")).toBeNull();
  });

  it("stk uten stykkvekt er ufullstendig", () => {
    expect(convertToGrams(3, "stk").exact).toBe(false);
  });

  it("går riktig vei tilbake", () => {
    expect(fromGrams(2000, "l", { densityGPerMl: 1 })).toBe(2);
    expect(fromGrams(180, "stk", { pieceWeightG: 60 })).toBe(3);
    expect(Number.isNaN(fromGrams(1000, "l"))).toBe(true);
  });

  it("toLitres er uavhengig av tetthet", () => {
    expect(toLitres(2, "l")).toBe(2);
    expect(toLitres(50, "cl")).toBe(0.5);
    expect(toLitres(500, "g")).toBeNull();
  });
});

describe("computeUnitCount", () => {
  it("emnevekt vinner og deigsvinn trekkes fra", () => {
    expect(computeUnitCount({ dough_piece_grams: 500, dough_waste_pct: 2 }, 10000)).toBe(19);
  });
  it("faller tilbake til emner per batch", () => {
    expect(computeUnitCount({ units_per_batch: 24 }, 10000)).toBe(24);
  });
  it("faller til slutt tilbake på gammel enhetsvekt", () => {
    expect(computeUnitCount({ unit_weight_grams: 1000 }, 10000)).toBe(10);
  });
  it("svarer null når ingenting er kjent", () => {
    expect(computeUnitCount({}, 10000)).toBeNull();
  });
  it("gir samme antall som listene og delesiden bruker", () => {
    const lines: BakersLine[] = [
      { id: "1", recipe_part_id: "p", quantity: 10, unit: "kg", raw_material_id: "f", _rm: { id: "f", name: "Hvetemel", grain_classification: "wheat" } },
    ];
    const totals = computeTotalsForRecipe(lines, { dough_piece_grams: 500 });
    expect(totals.totalDoughG).toBe(10000);
    expect(totals.unitCount).toBe(20);
  });
});

describe("resolveFinalWeight", () => {
  it("prioriterer ferdigvekt per stk × antall", () => {
    const r = resolveFinalWeight({ finished_weight_grams: 400, yield_quantity: 5, yield_unit: "stk", yield_grams: 1000 }, 2500);
    expect(r.grams).toBe(2000);
  });
  it("bruker utbytte i gram når stk mangler", () => {
    expect(resolveFinalWeight({ yield_grams: 1800 }, 2000).grams).toBe(1800);
  });
  it("faller tilbake til innveid vekt minus stektap", () => {
    expect(resolveFinalWeight({ yield_loss_pct: 10 }, 2000).grams).toBe(1800);
  });
});

const flour = (q: number, unit: string): BakersLine => ({
  id: `l-${q}-${unit}`,
  recipe_part_id: "p",
  quantity: q,
  unit,
  raw_material_id: "rm-flour",
  _rm: { id: "rm-flour", name: "Hvetemel", grain_classification: "wheat", current_cost_price: 12, base_unit: "kg" },
});

describe("kost i editoren", () => {
  it("regner kost per kg fra kilopris", () => {
    const res = lineCost(flour(10, "kg"), 10000);
    expect(res.cost).toBe(120);
  });

  it("bruker literpris uten å kreve tetthet", () => {
    const line: BakersLine = {
      id: "olje", recipe_part_id: "p", quantity: 2, unit: "l", raw_material_id: "o",
      _rm: { id: "o", name: "Rapsolje", current_cost_price: 30, base_unit: "l" },
    };
    expect(lineCost(line, 0).cost).toBe(60);
  });

  it("melder fra i stedet for å regne 0 kr når kostprisen mangler", () => {
    const line: BakersLine = { id: "x", recipe_part_id: "p", quantity: 1, unit: "kg", raw_material_id: null, ingredient_name: "Ukjent" };
    const res = lineCost(line, 1000);
    expect(res.cost).toBeNull();
    expect(res.reason).toBe("Mangler kostpris");
  });

  it("summerer og markerer ufullstendig når en linje ikke kan veies", () => {
    const lines: BakersLine[] = [
      flour(10, "kg"),
      { id: "melk", recipe_part_id: "p", quantity: 2, unit: "l", raw_material_id: "m", _rm: { id: "m", name: "Melk", current_cost_price: 15, base_unit: "kg" } },
    ];
    const res = computeRecipeCost(lines);
    expect(res.incomplete).toBe(true);
    expect(res.costPerKg).toBeNull();
    expect(res.missing[0].name).toBe("Melk");
  });

  it("gir kost per kg og per emne når alt er kjent", () => {
    const res = computeRecipeCost([flour(10, "kg")], { unitCount: 20, totalDoughG: 10000 });
    expect(res.totalCost).toBe(120);
    expect(res.costPerKg).toBe(12);
    expect(res.costPerUnit).toBe(6);
  });
});

describe("ingen stille reset", () => {
  const base = { loadedRecipeId: "a", loadedUpdatedAt: "t1", incomingRecipeId: "a", incomingUpdatedAt: "t1" };
  it("hydrerer en ny oppskrift", () => {
    expect(decideHydration({ ...base, loadedRecipeId: null, dirty: false })).toBe("hydrate");
  });
  it("hydrerer når editoren er ren", () => {
    expect(decideHydration({ ...base, dirty: false })).toBe("hydrate");
  });
  it("rører ikke ulagrede endringer ved samme versjon", () => {
    expect(decideHydration({ ...base, dirty: true })).toBe("skip");
  });
  it("varsler i stedet for å overskrive når serveren er nyere", () => {
    expect(decideHydration({ ...base, dirty: true, incomingUpdatedAt: "t2" })).toBe("conflict");
  });
});

describe("samlet validering før lagring", () => {
  const part: EditorPart = {
    id: "p1", name: "Hoveddeig", sort_order: 0, instructions: null,
    prep_time_minutes: null, rest_time_minutes: null, part_type: "dough",
    preferment_kind: null, target_temp_celsius: null, ripe_time_hours: null,
  };
  const line = (over: Partial<EditorLine>): EditorLine => ({
    id: "l1", recipe_part_id: "p1", quantity: 1000, unit: "g", raw_material_id: null,
    waste_percent: 0, sort_order: 0, ingredient_name: "Hvetemel", ...over,
  });
  const input = (over: Partial<Parameters<typeof validateRecipeSave>[0]> = {}) => ({
    recipeId: "r1", displayName: "Grovbrød", originalPartIds: ["p1"],
    header: { name: "Grovbrød" }, parts: [part], lines: [line({})], steps: [], ...over,
  });

  it("godtar en gyldig oppskrift", () => {
    expect(validateRecipeSave(input())).toEqual([]);
  });
  it("krever navn", () => {
    expect(validateRecipeSave(input({ header: { name: "" } }))[0]).toContain("mangler navn");
  });
  it("avviser ukjent enhet", () => {
    expect(validateRecipeSave(input({ lines: [line({ unit: "klype" })] }))[0]).toContain("ukjent enhet");
  });
  it("avviser linje i en slettet del", () => {
    expect(validateRecipeSave(input({ lines: [line({ recipe_part_id: "borte" })] }))[0]).toContain("slettet");
  });
  it("avviser ugyldig tall på hodet", () => {
    expect(validateRecipeSave(input({ header: { name: "A", dough_piece_grams: -5 } }))[0]).toContain("Emnevekt");
  });
});
