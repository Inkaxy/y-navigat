import { describe, expect, it } from "vitest";
import { checkState, deriveLabelState, deriveNextAction } from "@/varer/lib/labelWorkspace";

describe("deriveLabelState", () => {
  it("uberegnet uten godkjenning", () => {
    expect(deriveLabelState({ computedAt: null, isStale: null, approvedAt: null })).toBe("not_computed");
  });
  it("beregnet men ikke godkjent", () => {
    expect(deriveLabelState({ computedAt: "2026-01-02", isStale: false, approvedAt: null })).toBe("computed");
  });
  it("godkjent etter beregning", () => {
    expect(deriveLabelState({ computedAt: "2026-01-01", isStale: false, approvedAt: "2026-01-02" })).toBe("approved");
  });
  it("utdatert når basen sier is_stale – aldri «aldri godkjent»", () => {
    expect(deriveLabelState({ computedAt: "2026-01-01", isStale: true, approvedAt: "2026-01-02" })).toBe("stale");
  });
  it("utdatert når beregning er nyere enn godkjenning", () => {
    expect(deriveLabelState({ computedAt: "2026-01-03", isStale: false, approvedAt: "2026-01-02" })).toBe("stale");
  });
});

describe("checkState", () => {
  it("tom/ulastet er ukjent, ikke OK", () => {
    expect(checkState(false, 0)).toBe("unknown");
    expect(checkState(true, null)).toBe("unknown");
  });
  it("beregnet uten mangler er OK", () => {
    expect(checkState(true, 0)).toBe("ok");
    expect(checkState(true, 2)).toBe("missing");
  });
});

describe("deriveNextAction", () => {
  it("ber om beregning først", () => {
    expect(deriveNextAction({ state: "not_computed", approveIssues: [] })).toBe("compute");
  });
  it("viser mangler når valgt kilde er sperret", () => {
    expect(deriveNextAction({ state: "computed", approveIssues: ["x"] })).toBe("show_missing");
  });
  it("gjennomgang når klar", () => {
    expect(deriveNextAction({ state: "stale", approveIssues: [] })).toBe("review");
  });
});
