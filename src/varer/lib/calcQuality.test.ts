import { describe, it, expect } from "vitest";
import { calcQuality, findCycle } from "./calcQuality";

describe("calcQuality", () => {
  it("gir A når kosten er komplett", () => {
    expect(calcQuality({ hasCost: true, costPrice: 12, hasRecipe: true, calcType: "oppskrift" })).toBe("A");
  });

  it("gir B når varen har oppskrift, men ingen kost", () => {
    expect(calcQuality({ hasCost: false, costPrice: null, hasRecipe: true, calcType: "oppskrift" })).toBe("B");
  });

  it("gir B for handelsvare uten kost", () => {
    expect(calcQuality({ hasCost: false, costPrice: 0, hasRecipe: false, calcType: "handelsvare" })).toBe("B");
  });

  it("gir C når verken kost eller kobling finnes", () => {
    expect(calcQuality({ hasCost: false, costPrice: null, hasRecipe: false, calcType: "oppskrift" })).toBe("C");
  });

  it("gir ukjent når varen ikke er vurdert", () => {
    expect(
      calcQuality({ hasCost: false, costPrice: null, hasRecipe: false, calcType: null, evaluated: false }),
    ).toBe("ukjent");
  });
});

describe("findCycle", () => {
  const graph = {
    recipesOfProduct: { deig: ["r-deig"], bolle: ["r-bolle"] },
    subProductsOfRecipe: { "r-deig": [], "r-bolle": ["deig"] },
  };

  it("finner ingen sirkel når halvfabrikatet er uavhengig", () => {
    expect(findCycle(graph, "bolle", "deig")).toBeNull();
  });

  it("finner sirkel når halvfabrikatet bruker varen selv", () => {
    const g = {
      recipesOfProduct: { deig: ["r-deig"], bolle: ["r-bolle"] },
      subProductsOfRecipe: { "r-deig": ["bolle"], "r-bolle": ["deig"] },
    };
    expect(findCycle(g, "bolle", "deig")).toEqual(["bolle", "deig", "bolle"]);
  });

  it("oppdager direkte selvreferanse", () => {
    expect(findCycle(graph, "deig", "deig")).toEqual(["deig", "deig"]);
  });
});
