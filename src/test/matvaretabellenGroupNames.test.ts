import { describe, it, expect } from "vitest";
import { MATVARETABELLEN_GROUP_NAMES } from "@/ravarer/lib/matvaretabellenGroupNames";
import {
  CATEGORY_FOOD_GROUPS,
  foodGroupFit,
  normalizeCategory,
} from "@/ravarer/lib/matvaretabellenGroups";

/**
 * Et gruppenavn med skrivefeil gir 0,75-straff i stedet for 1,15-bonus, og da
 * faller opplagte treff under grensen for automatisk kobling. Denne testen
 * vokter kartet mot den innsjekkede listen fra basen.
 */
describe("matvaregrupper", () => {
  const known = new Set(MATVARETABELLEN_GROUP_NAMES);

  it("listen er komplett (77 grupper) og uten duplikater", () => {
    expect(MATVARETABELLEN_GROUP_NAMES.length).toBe(77);
    expect(known.size).toBe(MATVARETABELLEN_GROUP_NAMES.length);
  });

  it.each(Object.keys(CATEGORY_FOOD_GROUPS))("%s peker bare på grupper som finnes", (category) => {
    for (const group of CATEGORY_FOOD_GROUPS[category]) {
      expect(known.has(group), `«${group}» finnes ikke i Matvaretabellen`).toBe(true);
    }
  });

  it("smør og margarin regnes som meieri", () => {
    expect(foodGroupFit("Meieri og egg", "Margarin og smør")).toBeGreaterThan(1);
    expect(foodGroupFit("Meieri og egg", "Annet fett")).toBeGreaterThan(1);
  });

  it("gamle småbokstav-kategorier mappes til dagens navn", () => {
    expect(normalizeCategory("noetter")).toBe("Frø, nøtter og kjerner");
    expect(normalizeCategory("mel")).toBe("Mel og korn");
    expect(normalizeCategory("meieri")).toBe("Meieri og egg");
    expect(normalizeCategory("fett")).toBe("Fett og olje");
    expect(foodGroupFit("mel", "Mel")).toBeGreaterThan(1);
  });
});
