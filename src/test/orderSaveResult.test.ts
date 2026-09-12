import { describe, it, expect } from "vitest";

import { parseOrderSaveResult, resolveExistingLineId } from "@/ordre/lib/orderSaveResult";

describe("parseOrderSaveResult", () => {
  it("godtar et komplett svar", () => {
    const r = parseOrderSaveResult({
      updated: 2,
      inserted: 1,
      deleted: 0,
      line_ids: [{ id: "a", line_number: 1 }, { id: "b", line_number: 2 }],
    });
    expect(r).toEqual({ updated: 2, inserted: 1, deleted: 0, lineIds: ["a", "b"] });
  });

  it.each([null, undefined, [], "ok", 1])("avviser svar uten objekt: %s", (data) => {
    expect(() => parseOrderSaveResult(data)).toThrow(/svar/i);
  });

  it("avviser manglende tellere", () => {
    expect(() => parseOrderSaveResult({ updated: 1, inserted: 1, line_ids: [] })).toThrow();
    expect(() =>
      parseOrderSaveResult({ updated: "1", inserted: 0, deleted: 0, line_ids: [] }),
    ).toThrow();
  });

  it("avviser line_ids som ikke er en liste med id-er", () => {
    expect(() =>
      parseOrderSaveResult({ updated: 0, inserted: 0, deleted: 0, line_ids: null }),
    ).toThrow();
    expect(() =>
      parseOrderSaveResult({ updated: 0, inserted: 0, deleted: 0, line_ids: [{ line_number: 1 }] }),
    ).toThrow();
  });
});

describe("resolveExistingLineId", () => {
  const existing = new Set(["l1", "l2"]);

  it("beholder en id som finnes på ordren", () => {
    expect(resolveExistingLineId("l1", existing)).toBe("l1");
  });

  it("gir null for en ny linje uten id", () => {
    expect(resolveExistingLineId(null, existing)).toBeNull();
    expect(resolveExistingLineId(undefined, existing)).toBeNull();
  });

  it("konverterer ALDRI en ukjent id stille til en ny linje", () => {
    expect(() => resolveExistingLineId("borte", existing)).toThrow(/endret av noen andre/i);
  });
});
