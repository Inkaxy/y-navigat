import { describe, it, expect } from "vitest";
import {
  assessSuggestions,
  suggestFoods,
  variantAttributes,
  type FoodSuggestion,
} from "@/ravarer/lib/foodSuggestions";
import { MATVARETABELLEN_FIXTURE } from "./matvaretabellenFixture";

const sug = (name: string, confidence: number): FoodSuggestion => ({
  food_id: name,
  food_name: name,
  food_group_name: null,
  confidence,
});

describe("variantAttributes", () => {
  it("leser fettprosent som verdi", () => {
    expect([...(variantAttributes("Melk 0,5 %").get("fettinnhold") ?? [])]).toEqual(["0.5 %"]);
  });

  it("skiller saltet fra usaltet", () => {
    expect([...(variantAttributes("Smør usaltet").get("salting") ?? [])]).toEqual(["usaltet"]);
    expect([...(variantAttributes("Smør, saltet").get("salting") ?? [])]).toEqual(["saltet"]);
  });
});

describe("assessSuggestions", () => {
  it("blokkerer motstridende salting", () => {
    const res = assessSuggestions({ name: "Smør usaltet" }, [sug("Smør, saltet", 0.95)]);
    expect(res.autoLinkAllowed).toBe(false);
    expect(res.reason).toContain("salting");
  });

  it("blokkerer feil fettprosent", () => {
    const res = assessSuggestions({ name: "Melk 0,5 %" }, [sug("Melk 3,5 %", 0.95)]);
    expect(res.autoLinkAllowed).toBe(false);
  });

  it("blokkerer når råvaren ikke sier noe om varianten", () => {
    const res = assessSuggestions({ name: "Melk" }, [sug("Melk, hel", 0.95)]);
    expect(res.autoLinkAllowed).toBe(false);
  });

  it("blokkerer rå mot kokt", () => {
    const res = assessSuggestions({ name: "Egg rå" }, [sug("Egg, kokt", 0.95)]);
    expect(res.autoLinkAllowed).toBe(false);
  });

  it("blokkerer glutenfri mot vanlig", () => {
    const res = assessSuggestions({ name: "Havregryn glutenfri" }, [sug("Havregryn", 0.95)]);
    expect(res.autoLinkAllowed).toBe(false);
  });

  it("blokkerer to nesten like treff", () => {
    const res = assessSuggestions({ name: "Melk" }, [sug("Melk, hel", 1), sug("Melk, skummet", 1)]);
    expect(res.autoLinkAllowed).toBe(false);
  });

  it("tillater entydige treff", () => {
    expect(assessSuggestions({ name: "Sukker" }, [sug("Sukker", 0.98)]).autoLinkAllowed).toBe(true);
    expect(assessSuggestions({ name: "Hvetemel" }, [sug("Hvetemel", 0.95)]).autoLinkAllowed).toBe(true);
  });

  it("tillater samsvarende variant begge veier", () => {
    expect(assessSuggestions({ name: "Smør usaltet" }, [sug("Smør, usaltet", 0.95)]).autoLinkAllowed).toBe(true);
  });
});

// ===== Akseptanse: ekte råvarenavn mot ekte kandidater fra basen =====

function check(rm: { name: string; declaration_name?: string | null; category?: string | null }) {
  const s = suggestFoods(rm, MATVARETABELLEN_FIXTURE, 3);
  return { top: s[0]?.food_name ?? null, confidence: s[0]?.confidence ?? 0, ...assessSuggestions(rm, s) };
}

describe("fasit mot ekte matvarenavn (8. sep 2026)", () => {
  const kobles: [string, { name: string; declaration_name?: string | null; category?: string | null }, string][] = [
    ["REGAL HVETEMEL INDUSTRI 25KG", { name: "REGAL HVETEMEL INDUSTRI 25KG", declaration_name: "hvetemel", category: "Mel og korn" }, "Hvetemel, siktet"],
    ["Hvetemel Activ Bulk", { name: "Hvetemel Activ Bulk", declaration_name: "hvetemel", category: "Mel og korn" }, "Hvetemel, siktet"],
    ["DANSK SUKKER 25 KG", { name: "DANSK SUKKER 25 KG", declaration_name: "sukker", category: "Sukker og søtning" }, "Sukker, hvitt"],
    ["BRUNT SUKKER", { name: "BRUNT SUKKER", category: "Sukker og søtning" }, "Sukker, brunt"],
    ["TINE Smør 25kg", { name: "TINE Smør 25kg", declaration_name: "smør", category: "Fett og olje" }, "Smør"],
    ["MEIERISMØR 500G TINE", { name: "MEIERISMØR 500G TINE", declaration_name: null, category: "Meieri og egg" }, "Smør"],
    ["TINE Helmelk 3,5% bib slim 10l", { name: "TINE Helmelk 3,5% bib slim 10l", declaration_name: "melk", category: "Meieri og egg" }, "Helmelk, 3,5 % fett, Tine"],
    ["Lett Tinemelk 1% m/kork 1/4l", { name: "Lett Tinemelk 1% m/kork 1/4l", category: "Meieri og egg" }, "Lettmelk, 1,0 % fett, Tine"],
    ["HELMELK", { name: "HELMELK", category: "Meieri og egg" }, "Helmelk, uspesifisert"],
    ["LETTMELK", { name: "LETTMELK", category: "Meieri og egg" }, "Lettmelk, uspesifisert"],
    ["EGG", { name: "EGG", category: "Meieri og egg" }, "Egg, rå"],
    ["HVETEMEL SAMMALT", { name: "HVETEMEL SAMMALT", category: "Mel og korn" }, "Hvetemel, sammalt, fint/grovt"],
    ["MATLAGINGSFETT", { name: "MATLAGINGSFETT", category: "Fett og olje" }, "Matlagingsfett, uspesifisert"],
    ["POTETMEL POTETSTIVELSE", { name: "POTETMEL POTETSTIVELSE", category: "Mel og korn" }, "Potetmel, potetstivelse"],
  ];

  for (const [label, rm, expected] of kobles) {
    it(`${label} → ${expected}`, () => {
      const r = check(rm);
      expect(r.top).toBe(expected);
      expect(r.reason).toBeNull();
      expect(r.autoLinkAllowed).toBe(true);
    });
  }

  it("TINE Lettrømme 17% 5kg foreslås øverst, men sperres på fettprosent", () => {
    const r = check({ name: "TINE Lettrømme 17% 5kg", category: "Meieri og egg" });
    expect(r.top).toBe("Lettrømme, 18 % fett");
    expect(r.autoLinkAllowed).toBe(false);
    expect(r.reason).toContain("Fettprosent avviker");
  });

  it("MELK 1L krever manuelt valg av fettinnhold", () => {
    const r = check({ name: "MELK 1L", category: "Meieri og egg" });
    expect(r.top).toBe("Melk, uspesifisert");
    expect(r.autoLinkAllowed).toBe(false);
    expect(r.reason).toContain("fettinnhold");
  });

  it("SMØREMYK ELDORADO kobles ikke — «smøre-» er ikke smør", () => {
    const r = check({ name: "SMØREMYK ELDORADO", category: "Fett og olje" });
    expect(r.autoLinkAllowed).toBe(false);
    // «smøremyk» er ikke smør — treffet er for svakt til å kobles, og
    // brukeren får se hvilke som er plausible.
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.reason).toContain("flere plausible");
  });

  it("GRØNN TE SITRON 100POS TWINING er sperret — ingen mat i basen matcher", () => {
    const r = check({ name: "GRØNN TE SITRON 100POS TWINING", category: "Diverse" });
    expect(r.autoLinkAllowed).toBe(false);
  });

  it("HOFF POTETSTIVELSE treffer potetstivelse med minst 0,80 i tillit", () => {
    const r = check({ name: "HOFF POTETSTIVELSE", declaration_name: "potetstivelse", category: "Mel og korn" });
    expect(r.top).toBe("Potetmel, potetstivelse");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("Monin-sirup foreslår «Sirup», men kobles ikke automatisk", () => {
    const r = check({ name: "MONIN JORDBÆRSIRUP 700ML", category: "Sukker og søtning" });
    expect(r.top).toBe("Sirup");
    expect(r.autoLinkAllowed).toBe(false);
  });
});

describe("poengsummene skiller søsknene", () => {
  const score = (rm: { name: string; category?: string | null }, food: string) => {
    const s = suggestFoods(rm, MATVARETABELLEN_FIXTURE, 20, 0);
    return s.find((x) => x.food_name === food)?.confidence ?? 0;
  };

  it("standardvarianten ligger et hakk over søsknene", () => {
    const mel = { name: "HVETEMEL", category: "Mel og korn" };
    expect(score(mel, "Hvetemel, siktet")).toBe(0.98);
    expect(score(mel, "Hvetemel, økologisk")).toBe(0.88);

    const sukker = { name: "SUKKER", category: "Sukker og søtning" };
    expect(score(sukker, "Sukker, hvitt")).toBe(0.98);
    expect(score(sukker, "Sukker, brunt")).toBe(0.88);
    expect(score(sukker, "Melis")).toBe(0.85);

    const smor = { name: "SMØR", category: "Fett og olje" };
    expect(score(smor, "Smør")).toBe(1);
    expect(score(smor, "Brelett")).toBe(0.85);

    const egg = { name: "EGG", category: "Meieri og egg" };
    expect(score(egg, "Egg, rå")).toBe(0.98);
    expect(score(egg, "Egg, kokt")).toBe(0.88);

    const helmelk = { name: "HELMELK", category: "Meieri og egg" };
    expect(score(helmelk, "Helmelk, uspesifisert")).toBe(0.98);
    expect(score(helmelk, "Helmelk, 3,5 % fett, Tine")).toBe(0.88);
  });

  it("merket variant slår laktosefri/uspesifisert når innkjøpsnavnet nevner merket", () => {
    const helmelkTine = { name: "TINE Helmelk 3,5 %", category: "Meieri og egg" };
    expect(score(helmelkTine, "Helmelk, 3,5 % fett, Tine")).toBe(1);
    expect(score(helmelkTine, "Helmelk, 3,5 % fett, laktosefri")).toBe(0.95);

    const lettmelkTine = { name: "TINE Lettmelk 1 %", category: "Meieri og egg" };
    const tineScore = score(lettmelkTine, "Lettmelk, 1,0 % fett, Tine");
    const uspesifisertScore = score(lettmelkTine, "Lettmelk, 1 % fett, uspesifisert");
    expect(tineScore).toBeGreaterThan(uspesifisertScore);
  });

  it("nærmeste fettprosent rangeres øverst ved avvik", () => {
    const s = suggestFoods({ name: "TINE Lettrømme 17% 5kg", category: "Meieri og egg" }, MATVARETABELLEN_FIXTURE, 5, 0);
    const names = s.map((x) => x.food_name);
    expect(names.indexOf("Lettrømme, 18 % fett")).toBeLessThan(names.indexOf("Lettrømme, 10 % fett"));
  });
});
