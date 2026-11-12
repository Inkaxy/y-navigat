import { describe, expect, it } from "vitest";
import { checkManualAllergens, manualAllergenIssues, markedPlainText } from "@/varer/lib/manualAllergenCheck";

const status = (text: string, known: string[]) =>
  Object.fromEntries(checkManualAllergens(text, known).findings.map((f) => [f.allergen, f.status]));

describe("checkManualAllergens", () => {
  it("godtar stjerner, <strong> og versaler som fremheving", () => {
    expect(status("*hvete*mel, vann", ["hvete"])).toEqual({ hvete: "ok" });
    expect(status("**hvete**mel, vann", ["hvete"])).toEqual({ hvete: "ok" });
    expect(status("<strong>hvete</strong>mel, vann", ["hvete"])).toEqual({ hvete: "ok" });
    expect(status("HVETEMEL, vann", ["hvete"])).toEqual({ hvete: "ok" });
  });

  it("gir ikke falske feil for sammensatte ord og bøyningsformer", () => {
    expect(status("HVETEMEL, *melk*eprotein, EGG", ["hvete", "melk", "egg"])).toEqual({ hvete: "ok", melk: "ok", egg: "ok" });
    expect(status("HASSELNØTTER, MANDLER", ["hasselnøtter", "mandler"])).toEqual({ hasselnøtter: "ok", mandler: "ok" });
    expect(status("sammalt SPELT, SESAMFRØ", ["spelt", "sesamfrø"])).toEqual({ spelt: "ok", sesamfrø: "ok" });
  });

  it("sperrer når allergenet mangler i teksten", () => {
    const r = checkManualAllergens("Vann, salt, gjær", ["hvete"]);
    expect(r.errors.map((f) => f.status)).toEqual(["missing"]);
  });

  it("sperrer når allergenet står helt uten fremheving", () => {
    const r = checkManualAllergens("Hvetemel, vann", ["hvete"]);
    expect(r.errors[0]).toMatchObject({ allergen: "hvete", status: "not_highlighted", unmarkedWords: ["Hvetemel"] });
  });

  it("bokhvete er ikke hvete", () => {
    expect(status("Bokhvete, vann", ["hvete"])).toEqual({ hvete: "missing" });
    expect(status("HVETEMEL, bokhvete", ["hvete"])).toEqual({ hvete: "ok" });
  });

  it("beslektet ord uten fremheving er advarsel, ikke sperre", () => {
    const r = checkManualAllergens("Hvetemel, smør", ["melk"]);
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatchObject({ allergen: "melk", status: "uncertain" });
    expect(status("*smør*, vann", ["melk"])).toEqual({ melk: "ok" });
  });

  it("kakaosmør og kokosmelk teller ikke som melk", () => {
    expect(status("kakaosmør, kokosmelk", ["melk"])).toEqual({ melk: "missing" });
  });

  it("delvis fremhevet er advarsel med ordet som mangler", () => {
    const r = checkManualAllergens("HVETEMEL, surdeig av hvete", ["hvete"]);
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatchObject({ status: "partly_highlighted", unmarkedWords: ["hvete"] });
  });

  it("ukjente allergener fra råvarene gir ukjent tilstand, ikke OK", () => {
    const r = checkManualAllergens("Hvetemel", null);
    expect(r.state).toBe("unknown");
    expect(manualAllergenIssues({ check: r }).warnings).toHaveLength(1);
    expect(manualAllergenIssues({ check: r }).errors).toEqual([]);
  });

  it("ingen kjente allergener gir ingen funn", () => {
    expect(checkManualAllergens("Vann", []).findings).toEqual([]);
  });

  it("råvarer uten allergenvurdering gir advarsel", () => {
    const r = checkManualAllergens("HVETEMEL", ["hvete"]);
    expect(manualAllergenIssues({ check: r, unreviewedCount: 2 }).warnings).toEqual([
      "2 råvarer er ikke vurdert for allergener, så kontrollen kan være ufullstendig.",
    ]);
  });

  it("markedPlainText fjerner markører og husker hva som var markert", () => {
    const { plain, marked } = markedPlainText("*ab*c");
    expect(plain).toBe("abc");
    expect(marked).toEqual([true, true, false]);
  });
});

import { labelApproveIssues } from "@/varer/lib/labelApproveIssues";

describe("labelApproveIssues — manuell kilde", () => {
  const nut = { energy_kj: 1, energy_kcal: 1, fat_g: 1, saturated_fat_g: 1, carbs_g: 1, sugars_g: 1, protein_g: 1, salt_g: 1 };
  const base = {
    recipeName: "Grovbrød",
    calculated: { ingredientText: "<strong>hvete</strong>mel", contains: ["hvete"], mayContain: [], nutrition: nut },
    netWeightGrams: null, shelfLifeDays: null, storageInstructions: null, producerName: null, producerAddress: null,
    coveragePct: 95, calculationBlocked: false, claimGrain: false, grainPct: null, claimKeyhole: false, keyholeQualifies: false,
    knownAllergens: ["hvete"],
  };
  it("sperrer godkjenning av manuell kilde når allergenet ikke er fremhevet", () => {
    const r = labelApproveIssues({ ...base, manual: { ingredientText: "Hvetemel, vann", contains: [], mayContain: [], nutrition: nut } });
    expect(r.manual.some((m) => m.startsWith("Allergener:"))).toBe(true);
    expect(r.auto).toEqual([]);
  });
  it("gir ingen sperre når allergenet er fremhevet", () => {
    const r = labelApproveIssues({ ...base, manual: { ingredientText: "HVETEMEL, vann", contains: ["hvete"], mayContain: [], nutrition: nut } });
    expect(r.manual).toEqual([]);
  });
  it("ukjente allergener (ikke beregnet) sperrer ikke manuell godkjenning", () => {
    const r = labelApproveIssues({ ...base, knownAllergens: null, manual: { ingredientText: "Hvetemel", contains: [], mayContain: [], nutrition: nut } });
    expect(r.manual).toEqual([]);
  });
});
