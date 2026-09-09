import { describe, expect, it } from "vitest";
import {
  BRAN_FACTOR,
  breadscalePct,
  fmtPct,
  grainCategoryFromPct,
  grainLevelLabel,
  GRAIN_CLASSIFICATION_OPTIONS,
} from "@/varer/lib/breadscale";
import { lineToGrams, type BakersLine } from "@/varer/lib/bakers";
import { brodskalaPctText } from "@/produksjon/features/etiketter/lib/labelPdf";

function line(partial: Partial<BakersLine>): BakersLine {
  return {
    id: partial.id ?? "l1",
    recipe_part_id: "p1",
    raw_material_id: partial.raw_material_id ?? "rm1",
    quantity: partial.quantity ?? 1,
    unit: partial.unit ?? "kg",
    ingredient_name: partial.ingredient_name,
    _rm: partial._rm ?? null,
    is_flour_override: partial.is_flour_override,
  };
}

describe("Brødskala'n — klient", () => {
  it("gir samme prosent som kjernen: 300 siktet + 200 sammalt + 50 hvetekli", () => {
    const pct = breadscalePct([
      { grams: 300, classification: "sifted_flour" },
      { grams: 200, classification: "whole_grain_flour" },
      { grams: 50, classification: "wheat_bran" },
    ]);
    expect(pct.pct).toBe(77.3);
    expect(pct.totalFlourGrams).toBe(550);
    expect(pct.coarseWeightedGrams).toBe(425);
    expect(grainCategoryFromPct(pct.pct!)).toBe("ekstra_grovt");
  });

  it("kli teller uvektet i nevneren og med faktor i telleren", () => {
    expect(BRAN_FACTOR.wheat_bran).toBe(4.5);
    expect(BRAN_FACTOR.rye_bran).toBe(4);
    expect(BRAN_FACTOR.oat_bran).toBe(2);
    expect(
      breadscalePct([
        { grams: 1000, classification: "sifted_flour" },
        { grams: 116, classification: "wheat_bran" },
      ]).pct,
    ).toBe(46.8);
  });

  it("kan overstige 100 % og beholder ekstra grovt", () => {
    const pct = breadscalePct([
      { grams: 450, classification: "whole_grain_flour" },
      { grams: 50, classification: "whole_grains" },
      { grams: 50, classification: "wheat_bran" },
    ]);
    expect(pct.pct!).toBeGreaterThan(100);
    expect(grainCategoryFromPct(pct.pct!)).toBe("ekstra_grovt");
  });

  it("uten melgrunnlag gir null — aldri 0 % fint", () => {
    expect(breadscalePct([{ grams: 500, classification: "not_grain" }]).pct).toBeNull();
    expect(breadscalePct([]).pct).toBeNull();
  });

  it("trinngrensene følger BKLF", () => {
    expect(grainCategoryFromPct(25.9)).toBe("fint");
    expect(grainCategoryFromPct(26)).toBe("halvgrovt");
    expect(grainCategoryFromPct(50.9)).toBe("halvgrovt");
    expect(grainCategoryFromPct(51)).toBe("grovt");
    expect(grainCategoryFromPct(75.9)).toBe("grovt");
    expect(grainCategoryFromPct(76)).toBe("ekstra_grovt");
    expect(grainLevelLabel("ekstra_grovt")).toBe("Ekstra grovt");
  });

  it("velgeren tilbyr bare klassene databasens CHECK godtar", () => {
    const values = GRAIN_CLASSIFICATION_OPTIONS.map((o) => o.value);
    // raw_materials_grain_classification_check tillater nøyaktig disse.
    expect(values.slice().sort()).toEqual(
      [
        "sifted_flour", "whole_grain_flour", "whole_grains", "wheat_bran", "rye_bran",
        "oat_bran", "gluten_free_grain", "other_flour", "not_grain",
      ].sort(),
    );
  });

  it("mel oppgitt i kg regnes om til gram før grovheten", () => {
    const g = lineToGrams(line({ quantity: 1.5, unit: "kg" }));
    expect(g.grams).toBe(1500);
    expect(g.exact).toBe(true);
    expect(
      breadscalePct([
        { grams: g.grams, classification: "whole_grain_flour" },
        { grams: lineToGrams(line({ quantity: 1.5, unit: "kg" })).grams, classification: "sifted_flour" },
      ]).pct,
    ).toBe(50);
  });

  it("prosenten formateres med komma og trykkes på etiketten", () => {
    expect(fmtPct(77.25)).toBe("77,3 %");
    expect(
      brodskalaPctText({ felter: { brodskala_pct: 77.25 } } as never),
    ).toBe("77,3 %");
    expect(brodskalaPctText({ felter: {} } as never)).toBeNull();
  });
});
