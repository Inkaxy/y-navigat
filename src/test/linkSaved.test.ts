import { describe, expect, it } from "vitest";
import { assertScopedLinkSaved, NothingSavedError } from "@/fakturaer/lib/linkSaved";

describe("link-supplier-item: lagret bare når linjer faktisk ble endret", () => {
  it("linjeutvalg + 0 linjer = ingenting lagret (alle skjermer som sender line_ids)", () => {
    expect(() => assertScopedLinkSaved({ line_ids: ["a", "b"] }, { lines_updated: 0 })).toThrow(NothingSavedError);
  });
  it("linjeutvalg + 2 linjer = lagret", () => {
    expect(() => assertScopedLinkSaved({ line_ids: ["a", "b"] }, { lines_updated: 2 })).not.toThrow();
  });
  it("uten linjeutvalg lagres koblingen selv med 0 linjer (eldre opprett-vei)", () => {
    expect(() => assertScopedLinkSaved({}, { lines_updated: 0 })).not.toThrow();
  });
});
