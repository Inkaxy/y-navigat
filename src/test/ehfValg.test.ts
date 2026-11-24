import { describe, expect, it } from "vitest";
import { decideEhf, type EhfRawLine } from "../../supabase/pending/functions/_shared/ehfLines";

const line = (total: number) => ({ total_amount: total }) as EhfRawLine;
const parse = (totals: number[], doc: number, credit = false) => ({
  ok: true as const, credit, invoiceNumber: "1", lineExtensionTotal: doc, taxExclusiveTotal: doc, lines: totals.map(line),
});

describe("EHF-valg (20261124_ehf_valg)", () => {
  it("godtar faktura med rabatt-/returlinje med minus når summen med fortegn stemmer", () => {
    expect(decideEhf(parse([500, 300, -100], 700), 700)).toEqual({ use: true });
  });
  it("avviser når summen med fortegn ikke stemmer", () => {
    expect(decideEhf(parse([500, 300, -100], 900), null).use).toBe(false);
  });
  it("godtar kreditnota der alle linjer er negative og dokumentsummen positiv", () => {
    expect(decideEhf(parse([-200, -50], 250, true), -250)).toEqual({ use: true });
  });
});
