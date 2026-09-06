import { describe, it, expect } from "vitest";
import {
  applyView,
  buildSearchText,
  deviationPct,
  matchesSearch,
  normalizeSearch,
  sortItems,
  type RawMaterialListItem,
} from "@/ravarer/lib/rawMaterialViews";

function item(patch: Partial<RawMaterialListItem> = {}): RawMaterialListItem {
  return {
    id: "1",
    sku: "RM-1",
    name: "Hvetemel",
    declarationName: "hvetemel",
    categories: ["Mel og korn"],
    itemType: "ravare",
    isActive: true,
    baseUnit: "kg",
    costPrice: 10,
    costSource: "invoice",
    costUpdatedAt: null,
    agreedPrice: 9,
    supplierId: "s1",
    supplierName: "Lantmännen",
    supplierSku: "12345",
    primaryLinkId: "l1",

    matchedAlias: null,
    lastInvoicePrice: 10,
    lastInvoiceDate: "2026-01-01",
    deviation: 0,
    packageState: "confirmed",
    volume12m: 100,
    currentStock: 0,
    stockTracking: false,
    minStock: null,
    hasNutrition: true,
    hasDatasheet: true,
    hasAllergens: true,
    aliases: [],
    searchText: buildSearchText(["Hvetemel", "RM-1", "12345"]),
    ...patch,
  };
}

describe("normalisering og søk", () => {
  it("fjerner diakritika og komprimerer mellomrom", () => {
    expect(normalizeSearch("  Créme   Fraîche ")).toBe("creme fraiche");
  });

  it("finner råvaren på leverandørens varenummer", () => {
    const i = item({ searchText: buildSearchText(["Hvetemel", "RM-1", "12345"]) });
    expect(matchesSearch(i.searchText, "12345")).toBe(true);
  });

  it("finner råvaren på bekreftet alias uavhengig av diakritika", () => {
    const i = item({
      aliases: ["MEL Ø-KVERN"],
      searchText: buildSearchText(["Hvetemel", "RM-1", "MEL Ø-KVERN"]),
    });
    expect(matchesSearch(i.searchText, "mel o-kvern")).toBe(false);
    expect(matchesSearch(i.searchText, "mel ø-kvern")).toBe(true);
    expect(matchesSearch(i.searchText, "  MEL   Ø-KVERN ")).toBe(true);
  });

  it("krever at alle søkeord treffer", () => {
    const i = item();
    expect(matchesSearch(i.searchText, "hvetemel 12345")).toBe(true);
    expect(matchesSearch(i.searchText, "hvetemel 999")).toBe(false);
  });
});

describe("avviksberegning", () => {
  it("regner prosentavvik mellom siste fakturapris og kostpris", () => {
    expect(deviationPct(11, 10)).toBeCloseTo(10);
    expect(deviationPct(9, 10)).toBeCloseTo(-10);
  });

  it("gir null når data mangler eller kostpris er null", () => {
    expect(deviationPct(null, 10)).toBeNull();
    expect(deviationPct(10, null)).toBeNull();
    expect(deviationPct(10, 0)).toBeNull();
  });
});

describe("lagrede visninger", () => {
  const items = [
    item({ id: "pkg", packageState: "missing" }),
    item({ id: "decl", declarationName: null }),
    item({ id: "nutr", hasNutrition: false }),
    item({ id: "dev", deviation: 12 }),
    item({ id: "novol", volume12m: 0 }),
    item({ id: "nosup", supplierId: null }),
    item({ id: "inactive", isActive: false }),
  ];

  it("Alle beholder alt", () => {
    expect(applyView(items, "all")).toHaveLength(items.length);
  });

  it("filtrerer på hver visning", () => {
    expect(applyView(items, "missing_package").map((i) => i.id)).toEqual(["pkg"]);
    expect(applyView(items, "missing_declaration").map((i) => i.id)).toEqual(["decl"]);
    expect(applyView(items, "missing_nutrition").map((i) => i.id)).toEqual(["nutr"]);
    expect(applyView(items, "deviation", 5).map((i) => i.id)).toEqual(["dev"]);
    expect(applyView(items, "not_purchased").map((i) => i.id)).toEqual(["novol"]);
    expect(applyView(items, "no_supplier").map((i) => i.id)).toEqual(["nosup"]);
    expect(applyView(items, "inactive").map((i) => i.id)).toEqual(["inactive"]);
  });

  it("respekterer toleransen for avvik", () => {
    expect(applyView(items, "deviation", 20)).toHaveLength(0);
  });
});

describe("sortering", () => {
  it("sorterer på volum begge veier", () => {
    const list = [item({ id: "a", volume12m: 5 }), item({ id: "b", volume12m: 50 })];
    expect(sortItems(list, "volume_12m", "asc").map((i) => i.id)).toEqual(["a", "b"]);
    expect(sortItems(list, "volume_12m", "desc").map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("legger manglende tall først ved stigende sortering", () => {
    const list = [item({ id: "a", costPrice: 5 }), item({ id: "b", costPrice: null })];
    expect(sortItems(list, "cost", "asc").map((i) => i.id)).toEqual(["b", "a"]);
  });
});
