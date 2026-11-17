import { describe, expect, it } from "vitest";
import { NothingSavedError, assertLinesSaved, splitLockedLines } from "./linkOutcome";

describe("Nye varer: kvittering bare ved bekreftet lagring", () => {
  it("0 endrede linjer er ikke lagret", () => {
    expect(() => assertLinesSaved({ lines_updated: 0 })).toThrow(NothingSavedError);
    expect(() => assertLinesSaved({ lines_updated: Number.NaN })).toThrow(NothingSavedError);
    expect(() => assertLinesSaved({ lines_updated: 2 })).not.toThrow();
  });
  it("låste linjer (internt godkjent faktura) skilles ut", () => {
    const open = [{ id: "a", invoice_approved: true }, { id: "b", invoice_approved: false }];
    expect(splitLockedLines(open, (l) => l.invoice_approved)).toEqual({ linkable: [open[1]], locked: [open[0]] });
  });
});
