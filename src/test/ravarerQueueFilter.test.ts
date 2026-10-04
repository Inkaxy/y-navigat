import { describe, it, expect } from "vitest";
import { filterRavarerGroups, nextGroupKey, paginate, parseRavarerFilter, sumByCurrency } from "@/fakturaer/lib/ravarerQueueFilter";
import type { DecisionGroup } from "@/fakturaer/lib/decisionGroups";

const G = (key: string, kind: DecisionGroup["kind"], extra: Partial<DecisionGroup> = {}) =>
  ({ key, kind, supplierId: "s1", supplierName: "ASKO", sku: "60241", description: "Matfløte", lines: [], invoiceIds: ["a"], shared: true, observedPerBase: null, expectedPerBase: null, differenceExclVat: null, ...extra }) as DecisionGroup;

describe("Råvarer-kø: filter og sider", () => {
  const groups = Array.from({ length: 30 }, (_, i) => G(`k${i}`, i % 3 === 0 ? "package" : i % 3 === 1 ? "first_cost" : "material", i === 5 ? { supplierId: "s2", supplierName: "Tine", sku: "X-9", description: "Smør" } : {}));
  it("filtrerer hele køen og teller riktig total", () => {
    expect(filterRavarerGroups(groups, { kind: "alle", search: "", supplierId: "" })).toHaveLength(30);
    expect(filterRavarerGroups(groups, { kind: "package", search: "", supplierId: "" })).toHaveLength(10);
    expect(filterRavarerGroups(groups, { kind: "alle", search: "x-9", supplierId: "" }).map((g) => g.key)).toEqual(["k5"]);
    expect(filterRavarerGroups(groups, { kind: "alle", search: "tine", supplierId: "" })).toHaveLength(1);
    expect(filterRavarerGroups(groups, { kind: "alle", search: "", supplierId: "s2" })).toHaveLength(1);
    expect(filterRavarerGroups([G("p", "price")], { kind: "alle", search: "", supplierId: "" })).toHaveLength(0);
  });
  it("12 per side, siste side har resten", () => {
    const p = paginate(groups, 3, 12);
    expect(p.pages).toBe(3);
    expect(p.items).toHaveLength(6);
    expect(paginate(groups, 99, 12).page).toBe(3);
  });
  it("leser ugyldig URL trygt", () => {
    expect(parseRavarerFilter(new URLSearchParams("type=tull&side=-2"))).toEqual({ kind: "alle", search: "", supplierId: "", page: 1 });
  });
  it("neste spørsmål følger rekkefølgen", () => {
    expect(nextGroupKey(groups, "k3")).toBe("k4");
    expect(nextGroupKey(groups, "k29")).toBe("k0");
    expect(nextGroupKey([G("a", "material")], "a")).toBeNull();
  });
});

describe("Fakturaer: sum per valuta", () => {
  it("legger aldri sammen ulike valutaer og teller manglende beløp", () => {
    expect(sumByCurrency([{ total_amount: 100, currency: "NOK" }, { total_amount: 50.5, currency: "nok" }, { total_amount: 10, currency: "EUR" }, { total_amount: null, currency: "NOK" }]))
      .toEqual([{ currency: "EUR", total: 10, missing: 0 }, { currency: "NOK", total: 150.5, missing: 1 }]);
  });
});

describe("Alle beslutninger: prisavvik og øvrige typer er tilgjengelige", () => {
  const groups = [
    ...Array.from({ length: 20 }, (_, i) => G(`m${i}`, "material")),
    G("p1", "price", { description: "Hvetemel", sku: "M-1" }), G("p2", "price", { supplierId: "s2", supplierName: "Mølle" }), G("o1", "other"),
  ];
  it("tar med prisavvik og annet, med typefilter, søk og 12 per side", () => {
    const all = filterRavarerGroups(groups, { kind: "alle", search: "", supplierId: "" }, "alle");
    expect(all).toHaveLength(23);
    expect(paginate(all, 2, 12).items.map((g) => g.key)).toEqual(["m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "p1", "p2", "o1"]);
    expect(filterRavarerGroups(groups, { kind: "price", search: "", supplierId: "" }, "alle").map((g) => g.key)).toEqual(["p1", "p2"]);
    expect(filterRavarerGroups(groups, { kind: "other", search: "", supplierId: "" }, "alle").map((g) => g.key)).toEqual(["o1"]);
    expect(filterRavarerGroups(groups, { kind: "alle", search: "hvetemel", supplierId: "" }, "alle").map((g) => g.key)).toEqual(["p1"]);
  });
  it("URL-typen price godtas bare i alle-visningen; Råvarer holder seg uendret", () => {
    expect(parseRavarerFilter(new URLSearchParams("type=price"), "alle").kind).toBe("price");
    expect(parseRavarerFilter(new URLSearchParams("type=price")).kind).toBe("alle");
    expect(filterRavarerGroups(groups, { kind: "alle", search: "", supplierId: "" })).toHaveLength(20);
  });
  it("neste spørsmål etter et prisavvik følger samme filtrerte rekkefølge", () => {
    const prices = filterRavarerGroups(groups, { kind: "price", search: "", supplierId: "" }, "alle");
    expect(nextGroupKey(prices, "p1")).toBe("p2");
  });
});
