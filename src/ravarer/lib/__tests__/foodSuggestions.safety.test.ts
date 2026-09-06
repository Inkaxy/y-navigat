import { describe, it, expect } from "vitest";
import { assessSuggestions, variantAttributes, type FoodSuggestion } from "@/ravarer/lib/foodSuggestions";

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
