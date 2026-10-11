import { describe, expect, it } from "vitest";
import { isBulkAcceptable, lineStatus, type LineStatusInput } from "@/fakturaer/lib/lineStatus";

function line(over: Partial<LineStatusInput>): LineStatusInput {
  return {
    id: "l1",
    review_reason: null,
    requires_review: false,
    variance_status: null,
    raw_material_id: "rm1",
    match_confidence: "manual",
    quantity: 2,
    price_per_base_unit: 20,
    suggestions: [],
    invoice: null,
    ...over,
  };
}

describe("lineStatus — én hovedstatus per linje", () => {
  it("sikker match med ukjent pakning: råvare avklart, pakning må bekreftes, pris venter", () => {
    const s = lineStatus(line({ match_confidence: "auto_high", requires_review: true, review_reason: "unknown_package_size", price_per_base_unit: null }));
    expect(s.label).toBe("Bekreft pakning");
    expect(s.steps).toEqual({ material: "done", package: "action", price: "waiting" });
    expect(s.bucket).toBe("needs");
  });

  it("usikker råvare er et forslag, aldri bekreftet", () => {
    const s = lineStatus(line({ match_confidence: "auto_medium", requires_review: true, review_reason: "low_confidence" }));
    expect(s.label).toBe("Bekreft råvare");
    expect(s.steps.material).toBe("suggestion");
    expect(s.steps.price).toBe("waiting");
  });

  it("uten kobling og uten forslag: Velg råvare", () => {
    const s = lineStatus(line({ raw_material_id: null, match_confidence: "unmatched", requires_review: true, review_reason: "unmatched" }));
    expect(s.label).toBe("Velg råvare");
  });

  it("manglende prisgrunnlag: Se over pris", () => {
    const s = lineStatus(line({ variance_status: "no_baseline" }));
    expect(s.label).toBe("Se over pris");
    expect(s.steps.price).toBe("action");
  });

  it("prisavvik fra motoren: Se over pris", () => {
    const s = lineStatus(line({ requires_review: true, review_reason: "price_increase" }));
    expect(s.key).toBe("review_price");
  });

  it("kostpris uten beregnet tall er aldri klar", () => {
    const s = lineStatus(line({ price_per_base_unit: null }));
    expect(s.bucket).toBe("needs");
    expect(s.steps.price).toBe("action");
  });

  it("ugyldig mengde blokkerer pakning", () => {
    const s = lineStatus(line({ requires_review: true, quantity: 0 }));
    expect(s.label).toBe("Bekreft pakning");
  });

  it("endring etter bekreftelse (ny beregning) holder linjen åpen", () => {
    const s = lineStatus(line({ requires_review: true, review_reason: "recalculation_pending" }));
    expect(s.bucket).toBe("needs");
  });

  it("konflikt vinner over alt", () => {
    expect(lineStatus(line({ requires_review: true, review_reason: "sku_collision,price_increase" })).label).toBe("Løs konflikt");
  });

  it("ikke vare telles som behandlet", () => {
    const s = lineStatus(line({ match_confidence: "not_applicable", raw_material_id: null }));
    expect(s.bucket).toBe("done");
    expect(s.label).toBe("Ikke vare");
  });

  it("bekreftet kobling, pakning og pris: Klar", () => {
    expect(lineStatus(line({})).label).toBe("Klar");
  });
});

describe("isBulkAcceptable — samlegodkjenning bare for rene forslag", () => {
  const sugg = [{ confidence: 0.99 }];
  it("tar med umatchet linje med forslag og ingen andre årsaker", () => {
    expect(isBulkAcceptable(line({ raw_material_id: null, match_confidence: "unmatched", review_reason: "unmatched", suggestions: sugg }))).toBe(true);
  });
  it("høy matchprosent er ikke nok når pakningen er ukjent", () => {
    expect(
      isBulkAcceptable(line({ raw_material_id: null, match_confidence: "unmatched", review_reason: "unmatched,unknown_package_size", suggestions: sugg })),
    ).toBe(false);
  });
  it("utelater prisavvik og ikke-råvare", () => {
    expect(isBulkAcceptable(line({ raw_material_id: null, review_reason: "low_confidence,price_variance", suggestions: sugg }))).toBe(false);
    expect(isBulkAcceptable(line({ match_confidence: "not_applicable", suggestions: sugg }))).toBe(false);
  });
});
