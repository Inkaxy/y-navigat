import { describe, expect, it } from "vitest";
import {
  buildIlikeOr,
  entityRoute,
  groupEntityHits,
  sanitizeSearchTerm,
  type EntityHit,
} from "@/lib/entitySearch";

describe("sanitizeSearchTerm", () => {
  it("fjerner tegn som bryter PostgREST-filtersyntaksen", () => {
    expect(sanitizeSearchTerm("Bakeri, AS (Oslo).")).toBe("Bakeri AS Oslo");
  });

  it("fjerner jokertegn og komprimerer mellomrom", () => {
    expect(sanitizeSearchTerm("  100%_rug  ")).toBe("100 rug");
  });

  it("beholder rene tall", () => {
    expect(sanitizeSearchTerm("1042")).toBe("1042");
  });
});

describe("buildIlikeOr", () => {
  it("bygger ilike-uttrykk for hver kolonne", () => {
    expect(buildIlikeOr(["customer_number", "display_name"], "1042")).toBe(
      "customer_number.ilike.%1042%,display_name.ilike.%1042%",
    );
  });

  it("saniterer før uttrykket bygges", () => {
    expect(buildIlikeOr(["display_name"], "A, B")).toBe("display_name.ilike.%A B%");
  });
});

describe("groupEntityHits", () => {
  const hits: EntityHit[] = [
    ...Array.from({ length: 7 }, (_, i) => ({
      kind: "order" as const,
      id: `o${i}`,
      title: `O-${i}`,
    })),
    { kind: "customer", id: "c1", title: "Kunde 1042" },
    { kind: "ticket", id: "t1", title: "Sak" },
  ];

  it("grupperer i fast rekkefølge og kutter til fem per gruppe", () => {
    const groups = groupEntityHits(hits);
    expect(groups.map((g) => g.label)).toEqual(["Kunder", "Ordrer", "Saker"]);
    expect(groups[1].hits).toHaveLength(5);
  });

  it("utelater tomme grupper", () => {
    expect(groupEntityHits([]).length).toBe(0);
  });
});

describe("entityRoute", () => {
  it("peker til riktig side per type", () => {
    expect(entityRoute({ kind: "customer", id: "1", title: "" })).toBe("/kunder/kundeliste/1");
    expect(entityRoute({ kind: "order", id: "2", title: "" })).toBe("/ordre/ordrer/2");
    expect(entityRoute({ kind: "product", id: "3", title: "" })).toBe("/varer/vareliste/3");
    expect(entityRoute({ kind: "ticket", id: "4", title: "" })).toBe("/ordre/ticket/4");
  });
});
