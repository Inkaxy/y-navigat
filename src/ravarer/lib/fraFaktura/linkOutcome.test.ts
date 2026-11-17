import { describe, expect, it } from "vitest";
import { NothingSavedError, assertLinesSaved, splitLockedLines } from "./linkOutcome";

describe("Nye varer: kvittering bare ved bekreftet lagring", () => {
  it("0 endrede linjer er ikke lagret", () => {
    expect(() => assertLinesSaved({ lines_updated: 0 })).toThrow(NothingSavedError);
    expect(() => assertLinesSaved({ lines_updated: Number.NaN })).toThrow(NothingSavedError);
    expect(() => assertLinesSaved({ lines_updated: 2 })).not.toThrow();
  });
  it("linjer på internt godkjente fakturaer skilles ut", () => {
    const open = [{ id: "a", invoice_id: "f1" }, { id: "b", invoice_id: "f2" }];
    expect(splitLockedLines(open, new Set(["f1"]))).toEqual({ linkable: [open[1]], locked: [open[0]] });
    expect(splitLockedLines(open, undefined).linkable).toHaveLength(2);
  });
});
