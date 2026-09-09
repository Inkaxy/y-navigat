import { describe, expect, it } from "vitest";
import { allergenIsHighlighted, buildLabelChecklist, type LabelChecklistInput } from "@/varer/lib/labelChecklist";
import { computeStaleness, deriveLabelingStatus } from "@/varer/lib/labelStaleness";
import { nutritionDiff, nutritionDiffSummary, wordDiff } from "@/varer/lib/declarationDiff";
import { sanitizeDeclarationHtml } from "@/varer/lib/declarationHtml";

function complete(over: Partial<LabelChecklistInput> = {}): LabelChecklistInput {
  return {
    productName: "Grovbrød",
    ingredientText: "Sammalt **hvete**mel, vann, salt, gjær",
    contains: ["hvete"],
    mayContain: ["sesamfrø"],
    netWeightGrams: 750,
    shelfLifeDays: 4,
    storageInstructions: "Oppbevares tørt",
    producerName: "Nøtterø Bakeri",
    producerAddress: "Kirkeveien 1, 3140 Nøtterøy",
    nutrition: {
      energy_kj: 1050,
      energy_kcal: 250,
      fat_g: 2,
      saturated_fat_g: 0.4,
      carbs_g: 45,
      sugars_g: 2,
      protein_g: 9,
      salt_g: 1.1,
    },
    coveragePct: 96,
    ...over,
  };
}

describe("pliktfelt-sjekklisten (1169/2011)", () => {
  it("komplett etikett gir ingen røde punkter", () => {
    const r = buildLabelChecklist(complete());
    expect(r.blocked).toBe(false);
    expect(r.errors).toHaveLength(0);
    expect(r.items.find((i) => i.key === "may_contain")?.detail).toBe("sesamfrø");
  });

  it.each([
    ["productName", { productName: "" }, "name"],
    ["ingredientText", { ingredientText: "" }, "ingredients"],
    ["netWeightGrams", { netWeightGrams: null }, "net_weight"],
    ["shelfLifeDays", { shelfLifeDays: null }, "shelf_life"],
    ["producerName", { producerName: null }, "producer"],
    ["nutrition", { nutrition: null }, "nutrition"],
  ])("mangler %s → rødt punkt og sperre", (_n, over, key) => {
    const r = buildLabelChecklist(complete(over as Partial<LabelChecklistInput>));
    expect(r.blocked).toBe(true);
    expect(r.errors.map((e) => e.key)).toContain(key);
  });

  it("manglende oppbevaring er gult, ikke rødt", () => {
    const r = buildLabelChecklist(complete({ storageInstructions: "" }));
    expect(r.blocked).toBe(false);
    expect(r.items.find((i) => i.key === "storage")?.level).toBe("warn");
  });

  it("allergen som mangler helt i ingredienslisten sperrer", () => {
    const r = buildLabelChecklist(complete({ ingredientText: "Rugmel, vann", contains: ["hvete"] }));
    expect(r.errors.map((e) => e.key)).toContain("allergens");
  });

  it("manuell deklarasjon godtas uansett markering", () => {
    // Rendreren uthever per term, så *hvete*, **hvete**, <strong> og klartekst
    // (også VERSALER) skal alle passere.
    expect(allergenIsHighlighted("Sammalt <strong>hvete</strong>mel", "hvete")).toBe(true);
    expect(allergenIsHighlighted("Sammalt *hvete*mel", "hvete")).toBe(true);
    expect(allergenIsHighlighted("Sammalt **hvete**mel", "hvete")).toBe(true);
    expect(allergenIsHighlighted("HVETEMEL, vann", "hvete")).toBe(true);
    expect(
      buildLabelChecklist(complete({ ingredientText: "HVETEMEL, vann, salt", contains: ["hvete"] })).errors
        .map((e) => e.key),
    ).not.toContain("allergens");
  });

  it("under 90 % dekning sier eksplisitt at næringen utelates", () => {
    const r = buildLabelChecklist(complete({ coveragePct: 62.5 }));
    expect(r.errors.map((e) => e.key)).toContain("nutrition");
    expect(r.items.find((i) => i.key === "nutrition")?.detail).toContain("62,5 %");
  });

  it("merker uten grunnlag sperrer", () => {
    const r = buildLabelChecklist(complete({ claimKeyhole: true, keyholeQualifies: false, claimGrain: true, grainPct: null }));
    expect(r.errors.map((e) => e.key)).toEqual(expect.arrayContaining(["mark_keyhole", "mark_grain"]));
  });
});

describe("staleness", () => {
  const t = (s: string) => new Date(s).toISOString();

  it("nyere råvare enn beregningen gir utdatert med kildenavn", () => {
    const r = computeStaleness(t("2026-09-01T10:00:00Z"), [
      { name: "Oppskriften", updatedAt: t("2026-08-20T10:00:00Z") },
      { name: "Hvetemel", updatedAt: t("2026-09-05T08:00:00Z") },
    ]);
    expect(r.stale).toBe(true);
    expect(r.sourceName).toBe("Hvetemel");
  });

  it("ingen beregning = aldri beregnet", () => {
    expect(computeStaleness(null, []).neverComputed).toBe(true);
  });

  it("fersk beregning er ikke utdatert", () => {
    const r = computeStaleness(t("2026-09-08T10:00:00Z"), [{ name: "Hvetemel", updatedAt: t("2026-09-01T10:00:00Z") }]);
    expect(r.stale).toBe(false);
  });

  it("Merking-kolonnen avleder Godkjent / Utdatert / Mangler", () => {
    expect(
      deriveLabelingStatus({
        approvedAt: t("2026-09-08T12:00:00Z"),
        computedAt: t("2026-09-08T11:00:00Z"),
        sources: [{ name: "Hvetemel", updatedAt: t("2026-09-01T10:00:00Z") }],
      }),
    ).toBe("approved");
    expect(
      deriveLabelingStatus({
        approvedAt: t("2026-09-01T12:00:00Z"),
        computedAt: t("2026-09-02T11:00:00Z"),
        sources: [],
      }),
    ).toBe("stale");
    expect(
      deriveLabelingStatus({
        approvedAt: t("2026-09-08T12:00:00Z"),
        computedAt: t("2026-09-08T11:00:00Z"),
        sources: [{ name: "Hvetemel", updatedAt: t("2026-09-09T10:00:00Z") }],
      }),
    ).toBe("stale");
    expect(deriveLabelingStatus({ approvedAt: null, computedAt: t("2026-09-08T11:00:00Z"), sources: [] })).toBe("missing");
    expect(
      deriveLabelingStatus({ approvedAt: t("2026-09-08T12:00:00Z"), computedAt: null, sources: [], blocked: true }),
    ).toBe("missing");
  });
});

describe("diff", () => {
  it("ord-diff markerer bare det som endres", () => {
    const parts = wordDiff("Hvetemel, vann, salt", "Hvetemel, vann, havsalt");
    expect(parts.filter((p) => p.op === "removed").map((p) => p.text.trim())).toEqual(["salt"]);
    expect(parts.filter((p) => p.op === "added").map((p) => p.text.trim())).toEqual(["havsalt"]);
  });

  it("lik tekst gir ingen endringer", () => {
    expect(wordDiff("Hvetemel, vann", "Hvetemel, vann").every((p) => p.op === "same")).toBe(true);
  });

  it("næringsdiff gir «Salt 1,1 → 1,3»", () => {
    const rows = nutritionDiff({ salt_g: 1.1, protein_g: 9 }, { salt_g: 1.3, protein_g: 9 });
    expect(rows.find((r) => r.key === "protein_g")?.changed).toBe(false);
    expect(nutritionDiffSummary(rows)).toEqual(["Salt: 1,1 → 1,3"]);
  });

  it("manglende verdi vises som tankestrek", () => {
    expect(nutritionDiffSummary(nutritionDiff({ salt_g: null }, { salt_g: 1.2 }))).toEqual(["Salt: — → 1,2"]);
  });
});

describe("HTML-sanitering", () => {
  it("beholder bare uthevingen", () => {
    expect(sanitizeDeclarationHtml('<p>Hvetemel, <strong>melk</strong><span class="x">, salt</span></p>')).toBe(
      "Hvetemel, <strong>melk</strong>, salt",
    );
  });

  it("fjerner script og onerror-markup", () => {
    expect(sanitizeDeclarationHtml('<script>alert(1)</script>Mel<img src=x onerror="x()">')).toBe("Mel");
  });

  it("normaliserer <b> til <strong> og lukker uparede tagger", () => {
    expect(sanitizeDeclarationHtml("<b>hvete</b>mel")).toBe("<strong>hvete</strong>mel");
    expect(sanitizeDeclarationHtml("<strong>hvete")).toBe("<strong>hvete</strong>");
  });
});
