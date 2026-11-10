import { describe, expect, it } from "vitest";
import { draftLabelFlags, labelChecklistInput, labelProducerAddress } from "@/varer/lib/recipeLabelIssues";
import { buildLabelChecklist } from "@/varer/lib/labelChecklist";

const entity = { name: "Nøtterø Bakeri AS", address_line1: "Storgata 1", postal_code: "3140", city: "Nøtterøy" };

describe("felles etikettkontroll for merkefanen og «Gjenstår»", () => {
  it("produsentadresse settes sammen som før", () => {
    expect(labelProducerAddress(entity)).toBe("Storgata 1, 3140 Nøtterøy");
    expect(labelProducerAddress({ ...entity, address_line1: null })).toBe("3140 Nøtterøy");
    expect(labelProducerAddress({ name: null, address_line1: null, postal_code: null, city: null })).toBe("");
    expect(labelProducerAddress(null)).toBe("");
  });

  it("kladdens regler: sperre og næring følger dekning og kilde", () => {
    const base = {
      coveragePct: 80, calculationBlocked: true, hasNutrition: true, effectiveGrainPct: undefined,
      breadscaleManual: false, manualBreadscalePct: 55, calculatedGrainPct: 42,
    };
    expect(draftLabelFlags({ ...base, declarationManual: false })).toEqual({ coverageOk: false, blocked: true, nutritionUsable: false, grainPct: 42 });
    expect(draftLabelFlags({ ...base, declarationManual: true })).toEqual({ coverageOk: false, blocked: false, nutritionUsable: true, grainPct: 42 });
    expect(draftLabelFlags({ ...base, declarationManual: false, coveragePct: 95, breadscaleManual: true }).grainPct).toBe(55);
    expect(draftLabelFlags({ ...base, declarationManual: false, effectiveGrainPct: 61 }).grainPct).toBe(61);
  });

  it("samme inndata gir samme sjekkliste; næring holdes ute når den ikke kan brukes", () => {
    const src = {
      recipeName: "Grovbrød",
      effective: { ingredientText: "Hvetemel, vann", contains: ["hvete"], mayContain: [], nutrition: { energy_kj: 1000 } as never },
      effectiveGrainPct: null,
      declarationManual: false,
      claimGrain: false,
      claimKeyhole: false,
      unitWeightGrams: 750,
      shelfLifeDays: null,
      storageInstructions: null,
      entity,
      nutritionUsable: false,
      blocked: false,
      coveragePct: 80,
    };
    const input = labelChecklistInput(src);
    expect(input.nutrition).toBeNull();
    expect(input.producerAddress).toBe("Storgata 1, 3140 Nøtterøy");
    expect(input.coveragePct).toBe(80);
    expect(labelChecklistInput({ ...src, declarationManual: true }).coveragePct).toBeNull();
    const a = buildLabelChecklist(input);
    const b = buildLabelChecklist(labelChecklistInput(src));
    expect(a).toEqual(b);
    expect(a.items.find((i) => i.key === "shelf_life")?.level).not.toBe("ok");
  });
});
