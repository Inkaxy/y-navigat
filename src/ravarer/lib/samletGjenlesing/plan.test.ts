import { describe, expect, it } from "vitest";
import { buildPlan, estimateRunCost, skipReason, type PlanInvoice } from "./plan";
import { afterReload, classifyFailure, otherTabOwns, parseState, runCounts, type BulkRunState } from "./runState";

const base: PlanInvoice = {
  id: "i", invoice_number: "1", invoice_date: "2026-10-01", supplier_id: null, total_amount: 100, status: "needs_review",
  reconciled_at: null, flagged_at: null, source_document_url: "le/x.pdf", lines_sum_status: "mismatch",
  line_extraction_status: "done", line_extraction_at: "2026-10-02T08:00:00Z", line_count: 3, approved: false, costPosted: false, openRun: false, rereadAppliedAt: null,
};
const today = "2026-11-17";

describe("samlet gjenlesing – oppsummering før start", () => {
  it("hopper over med første gjeldende grunn", () => {
    expect(skipReason({ ...base, approved: true, costPosted: true }, today)).toBe("godkjent");
    expect(skipReason({ ...base, costPosted: true }, today)).toBe("kostpris_fort");
    expect(skipReason({ ...base, reconciled_at: "x" }, today)).toBe("last");
    expect(skipReason({ ...base, flagged_at: "x" }, today)).toBe("last");
    expect(skipReason({ ...base, source_document_url: null }, today)).toBe("mangler_pdf");
    expect(skipReason({ ...base, line_extraction_at: "2026-11-17T06:00:00Z", lines_sum_status: "ok" }, today)).toBe("lest_i_dag");
    expect(skipReason({ ...base, line_extraction_at: "2026-11-17T06:00:00Z", lines_sum_status: "mismatch" }, today)).toBeNull();
    expect(skipReason({ ...base, rereadAppliedAt: "2026-11-17T09:00:00Z", lines_sum_status: "ok" }, today)).toBe("lest_i_dag");
    expect(skipReason({ ...base, line_count: 0 }, today)).toBe("uten_linjer");
    expect(skipReason({ ...base, openRun: true }, today)).toBe("lesing_venter");
    expect(skipReason(base, today)).toBeNull();
  });

  it("leser eldste først og teller hoppet over per grunn", () => {
    const p = buildPlan([{ ...base, id: "b", invoice_date: "2026-10-05" }, { ...base, id: "a", invoice_date: "2026-09-01" }, { ...base, id: "c", approved: true }], today);
    expect(p.read.map((i) => i.id)).toEqual(["a", "b"]);
    expect(p.skipped.godkjent).toBe(1);
    expect(p.total).toBe(3);
  });

  it("kostnadsanslag bruker aktiv modell, ellers alle – ukjent logg er ukjent, aldri 0", () => {
    const rows = [
      { model: "m1", estimated_cost_usd: 0.02, success: true }, { model: "m1", estimated_cost_usd: 0.04, success: true }, { model: "m1", estimated_cost_usd: "0.03", success: true },
      { model: "m0", estimated_cost_usd: 1, success: true }, { model: "m1", estimated_cost_usd: 9, success: false },
    ];
    const c = estimateRunCost(rows, "m1", 100);
    expect(c.modelMatched).toBe(true);
    expect(c.perReadUsd).toBeCloseTo(0.03);
    expect(c.totalUsd).toBeCloseTo(3);
    expect(estimateRunCost(rows, "m2", 10).modelMatched).toBe(false);
    expect(estimateRunCost(null, "m1", 10).totalUsd).toBeNull();
  });
});

describe("samlet gjenlesing – kjøretilstand", () => {
  const s: BulkRunState = {
    v: 1, id: "r", legalEntityId: "le", userId: "u", startedAt: "t", dateLabel: "17.11.2026", status: "running", pauseReason: null,
    plannedSkips: { godkjent: 2 },
    items: [
      { invoiceId: "a", label: "A", phase: "done", runId: "x", attempts: 1, beginAt: null, outcome: "brukt", code: null, ops: null },
      { invoiceId: "b", label: "B", phase: "reading", runId: "y", attempts: 1, beginAt: "t", outcome: null, code: null, ops: null },
      { invoiceId: "c", label: "C", phase: "queued", runId: null, attempts: 0, beginAt: null, outcome: null, code: null, ops: null },
    ],
  };
  it("lagres og leses strengt, bundet til selskap og bruker", () => {
    const raw = JSON.stringify(s);
    expect(parseState(raw, "le", "u")?.items).toHaveLength(3);
    expect(parseState(raw, "annet", "u")).toBeNull();
    expect(parseState(raw, "le", "annen")).toBeNull();
    expect(parseState("{", "le", "u")).toBeNull();
  });
  it("omlasting stopper til «Fortsett», og tellingen viser N av M", () => {
    expect(afterReload(s).status).toBe("paused");
    const c = runCounts(s);
    expect([c.done, c.total, c.inProgress, c.byOutcome.brukt]).toEqual([1, 3, 1, 1]);
  });
  it("feil klassifiseres: hoppes over, stopp alt, ett nytt forsøk", () => {
    expect(classifyFailure("faktura_godkjent")).toBe("skip");
    expect(classifyFailure("ai_feil_nokkel")).toBe("pause_all");
    expect(classifyFailure("ai_feil")).toBe("retry");
    expect(classifyFailure("http_429")).toBe("retry");
    expect(classifyFailure("leser_ingen_linjer")).toBe("fail");
  });
  it("en annen fane eier kjøringen bare med fersk lås", () => {
    expect(otherTabOwns({ tabId: "b", at: 1000 }, "a", 5000)).toBe(true);
    expect(otherTabOwns({ tabId: "b", at: 1000 }, "a", 60_000)).toBe(false);
    expect(otherTabOwns({ tabId: "a", at: 1000 }, "a", 2000)).toBe(false);
  });
});
