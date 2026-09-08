import { describe, it, expect } from "vitest";
import {
  assessSuggestions,
  suggestFoods,
  variantAttributes,
  type FoodCandidate,
  type FoodSuggestion,
} from "@/ravarer/lib/foodSuggestions";

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

// ===== Akseptanse: «Koble alle ≥ 80 %» skal faktisk koble de opplagte =====

const MELK: FoodCandidate[] = [
  { food_id: "m1", food_name: "Melk, hel, 3,5 % fett", food_group_name: "Melk", search_keywords: ["helmelk"] },
  { food_id: "m2", food_name: "Melk, lett, 1 % fett", food_group_name: "Melk", search_keywords: ["lettmelk"] },
  { food_id: "m3", food_name: "Melk, skummet, 0,1 % fett", food_group_name: "Melk", search_keywords: ["skummet melk"] },
];

function check(rm: { name: string; category?: string | null }, foods: FoodCandidate[]) {
  const s = suggestFoods(rm, foods, 3);
  return { top: s[0]?.food_name ?? null, ...assessSuggestions(rm, s) };
}

describe("entydige treff kobles automatisk", () => {
  it("HVETEMEL", () => {
    const r = check({ name: "HVETEMEL", category: "Mel og korn" }, [
      { food_id: "f1", food_name: "Hvetemel", food_group_name: "Mel" },
      { food_id: "f2", food_name: "Hvetemel, siktet", food_group_name: "Mel" },
      { food_id: "f3", food_name: "Hvetemel, sammalt, fin", food_group_name: "Mel" },
    ]);
    expect(r.top).toBe("Hvetemel");
    expect(r.autoLinkAllowed).toBe(true);
  });

  it("SUKKER", () => {
    const r = check({ name: "SUKKER", category: "Sukker og søtning" }, [
      { food_id: "s1", food_name: "Sukker", food_group_name: "Sukker og honning" },
      { food_id: "s2", food_name: "Sukker, brunt", food_group_name: "Sukker og honning" },
    ]);
    expect(r.top).toBe("Sukker");
    expect(r.autoLinkAllowed).toBe(true);
  });

  it("SMØR", () => {
    const r = check({ name: "SMØR", category: "Meieri og egg" }, [
      { food_id: "b1", food_name: "Smør", food_group_name: "Margarin og smør" },
      { food_id: "b2", food_name: "Smør, usaltet", food_group_name: "Margarin og smør" },
      { food_id: "b3", food_name: "Margarin", food_group_name: "Margarin og smør" },
    ]);
    expect(r.top).toBe("Smør");
    expect(r.autoLinkAllowed).toBe(true);
  });

  it("EGG", () => {
    const r = check({ name: "EGG", category: "Meieri og egg" }, [
      { food_id: "e1", food_name: "Egg", food_group_name: "Egg" },
      { food_id: "e2", food_name: "Egg, kokt", food_group_name: "Egg" },
    ]);
    expect(r.top).toBe("Egg");
    expect(r.autoLinkAllowed).toBe(true);
  });

  it("HELMELK — «hel» er nok, prosenten i matvarenavnet er ingen konflikt", () => {
    const r = check({ name: "HELMELK", category: "Meieri og egg" }, MELK);
    expect(r.top).toBe("Melk, hel, 3,5 % fett");
    expect(r.autoLinkAllowed).toBe(true);
  });

  it("LETTMELK", () => {
    const r = check({ name: "LETTMELK", category: "Meieri og egg" }, MELK);
    expect(r.top).toBe("Melk, lett, 1 % fett");
    expect(r.autoLinkAllowed).toBe(true);
  });

  it("MELK 1L uten variant sperres", () => {
    const r = check({ name: "MELK 1L", category: "Meieri og egg" }, MELK);
    expect(r.autoLinkAllowed).toBe(false);
  });

  it("Rømme mot «Rømme, lett» sperres når råvaren ikke sier lett", () => {
    const r = check({ name: "Rømme", category: "Meieri og egg" }, [
      { food_id: "r1", food_name: "Rømme, lett", food_group_name: "Fløte og rømme" },
    ]);
    expect(r.autoLinkAllowed).toBe(false);
  });
});
