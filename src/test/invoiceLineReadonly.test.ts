import { describe, it, expect } from "vitest";
import { invoiceLineLock } from "@/ravarer/pages/priskontroll/faktura/exclusionView";
import { nextInvoiceStep, type NextStepInput } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";

const known = (approved: boolean) => ({ approved, known: true });

describe("invoiceLineLock: skrivebeskyttelse på fakturalinjer", () => {
  it("godkjent needs_review er skrivebeskyttet", () => {
    const l = invoiceLineLock("needs_review", null, known(true));
    expect(l.locked && l.kind).toBe("approved");
  });
  it("ukjent godkjenning er skrivebeskyttet (fail-closed)", () => {
    expect(invoiceLineLock("needs_review", null, { approved: false, known: false }).locked).toBe(true);
    expect(invoiceLineLock("needs_review", null, { approved: false, known: undefined }).locked).toBe(true);
  });
  it("utelatt og avstemt er skrivebeskyttet", () => {
    expect(invoiceLineLock("excluded", "2026-10-01", known(false)).locked).toBe(true);
    expect(invoiceLineLock("needs_review", "2026-10-01", known(false)).locked).toBe(true);
    expect(invoiceLineLock("reconciled", null, known(false)).locked).toBe(true);
  });
  it("åpen kjent status uten godkjenning er skrivbar (også etter tilbakekalt godkjenning)", () => {
    for (const st of ["imported", "needs_review", "ready"]) expect(invoiceLineLock(st, null, known(false)).locked).toBe(false);
  });
});

const base: NextStepInput = {
  status: "needs_review", received_at: "2026-10-01", line_count: 10, lines_source: "tripletex", line_extraction_status: "done",
  open_count: 7, lines_sum_status: "ok", reconciled_mode: null, is_credit_note: false, source: "tripletex",
  canReconcile: false, reconcileBlockedReason: null, canWrite: true, canReconcileRight: true, canApprove: true, canPostCosts: true,
  approved: false, costPosted: false, known: true,
};

describe("nextInvoiceStep: ingen «Avklar» på låst faktura", () => {
  it("godkjent med åpne linjer viser skrivebeskyttet, ikke Avklar", () => {
    const n = nextInvoiceStep({ ...base, approved: true });
    expect(n.key).toBe("kontroll_etterkontroll");
    expect(n.enabled).toBe(false);
  });
  it("ukjent godkjenning med åpne linjer er sperret", () => {
    const n = nextInvoiceStep({ ...base, known: false });
    expect(n.key).toBe("status_ukjent");
    expect(n.enabled).toBe(false);
  });
  it("åpen kjent uten godkjenning gir Avklar", () => {
    expect(nextInvoiceStep(base).key).toBe("avklar");
  });
});
