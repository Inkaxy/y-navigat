import { describe, expect, it } from "vitest";
import {
  buildIlikeOr,
  isNumericTerm,
  parseTicketPrefix,
  parseTicketRef,
  ticketPrefixRange,
  entityRoute,
  groupEntityHits,
  sanitizeSearchTerm,
  type EntityHit,
} from "@/lib/entitySearch";

describe("parseTicketPrefix", () => {
  it("godtar korte hex-referanser", () => {
    expect(parseTicketPrefix("T-1a2b")).toBe("1a2b");
    expect(parseTicketPrefix("#ab")).toBe("ab");
  });

  it("returnerer null for full uuid og ugyldig tekst", () => {
    expect(parseTicketPrefix("3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8")).toBeNull();
    expect(parseTicketPrefix("kringle")).toBeNull();
    expect(parseTicketPrefix("z1")).toBeNull();
  });
});

describe("ticketPrefixRange", () => {
  it("bygger uuid-intervall som tilsvarer «begynner med»", () => {
    expect(ticketPrefixRange("1a2b")).toEqual({
      lo: "1a2b0000-0000-0000-0000-000000000000",
      hi: "1a2bffff-ffff-ffff-ffff-ffffffffffff",
    });
  });
});

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

describe("parseTicketRef", () => {
  const uuid = "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

  it("godtar ren uuid og «T-»/«#»-prefiks", () => {
    expect(parseTicketRef(uuid)).toBe(uuid);
    expect(parseTicketRef(`T-${uuid}`)).toBe(uuid);
    expect(parseTicketRef(`#${uuid}`)).toBe(uuid);
  });

  it("returnerer null for vanlig fritekst", () => {
    expect(parseTicketRef("kringle")).toBeNull();
    expect(parseTicketRef("1042")).toBeNull();
  });
});

describe("isNumericTerm", () => {
  it("kjenner igjen rene tall", () => {
    expect(isNumericTerm(" 1042 ")).toBe(true);
    expect(isNumericTerm("10 42")).toBe(false);
    expect(isNumericTerm("A1042")).toBe(false);
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
