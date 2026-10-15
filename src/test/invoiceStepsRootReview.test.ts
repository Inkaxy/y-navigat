import { describe, expect, it } from "vitest";
import { extrasFromCounts, nextInvoiceStep, noSafeKey, type NextStepInput } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import { fetchDeliveryExtras } from "@/ravarer/hooks/useInvoiceDeliveryStatus";
import { createFakeClient } from "./edge/fakeSupabase";

const ni = (o: Partial<NextStepInput>): NextStepInput => ({
  status: "ready", received_at: null, line_count: 2, lines_source: null, line_extraction_status: "done", open_count: 0,
  lines_sum_status: "ok", source: "tripletex", canReconcile: true, reconcileBlockedReason: null,
  canWrite: true, canReconcileRight: true, canApprove: true, canPostCosts: true, ...extrasFromCounts(false, 0, 2), ...o,
});

describe("1: «ingen trygge linjer» kan prøves igjen etter retting", () => {
  const inv = { id: "i1", updated_at: "2026-10-15T10:00:00.123456+00", invoice_lines: [{ id: "l1", updated_at: "2026-10-15T10:00:00.1+00" }, { id: "l2", updated_at: "a" }] };
  it("samme grunnlag gir samme nøkkel; ny linjeversjon (rematch/startpris) nullstiller merket", () => {
    const k = noSafeKey(inv, 0);
    expect(noSafeKey({ ...inv, invoice_lines: [...inv.invoice_lines].reverse() }, 0)).toBe(k);
    expect(noSafeKey({ ...inv, invoice_lines: [{ id: "l1", updated_at: "2026-10-15T10:05:00+00" }, inv.invoice_lines[1]] }, 0)).not.toBe(k);
    expect(noSafeKey({ ...inv, updated_at: "2026-10-15T10:06:00+00" }, 0)).not.toBe(k);
    expect(noSafeKey(inv, 1)).not.toBe(k);
  });
  it("etter retting er primærsteget vanlig «Før kostpris» igjen", () => {
    const marked = noSafeKey(inv, 0);
    const after = noSafeKey({ ...inv, invoice_lines: [{ id: "l1", updated_at: "ny" }, inv.invoice_lines[1]] }, 0);
    expect(nextInvoiceStep(ni({ noSafeLines: marked === noSafeKey(inv, 0) })).key).toBe("kostkontroll");
    expect(nextInvoiceStep(ni({ noSafeLines: marked === after })).key).toBe("kostpris");
  });
  it("kostkontroll er et eksplisitt nytt forsøk med vanlige rettigheter — aldri automatisk", () => {
    const n = nextInvoiceStep(ni({ noSafeLines: true }));
    expect(n.label).toMatch(/^Prøv kostprisføring igjen/);
    expect(n.enabled).toBe(true);
    expect(nextInvoiceStep(ni({ noSafeLines: true, canPostCosts: false })).enabled).toBe(false);
  });
});

describe("2: bare aktiv godkjenning teller", () => {
  it("tilbakekalt godkjenning gir ikke godkjent", async () => {
    const db = createFakeClient({
      invoice_internal_approvals: [
        { invoice_id: "a", status: "approved", revoked_at: null },
        { invoice_id: "b", status: "approved", revoked_at: "2026-10-01" },
        { invoice_id: "c", status: "rejected", revoked_at: null },
      ],
      invoice_line_cost_postings: [{ invoice_id: "a", revoked_at: null }, { invoice_id: "b", revoked_at: "2026-10-01" }],
      invoice_lines: [{ id: "1", invoice_id: "a" }, { id: "2", invoice_id: "b" }],
    });
    const m = await fetchDeliveryExtras(db as never, ["a", "b", "c"]);
    expect(m.get("a")).toMatchObject({ approved: true, costPosted: true, known: true });
    expect(m.get("b")).toMatchObject({ approved: false, costPosted: false });
    expect(m.get("c")?.approved).toBe(false);
  });
});

describe("3: Ferdig krever faktisk kontroll", () => {
  const final = { status: "reconciled", ...extrasFromCounts(true, 2, 2) };
  it("full kost + avstemt + godkjent + sum ok + ingen åpne = Ferdig", () => {
    expect(nextInvoiceStep(ni(final)).key).toBe("ferdig");
  });
  for (const sum of [null, "not_checked", "mismatch", "no_lines", "no_total"]) {
    it(`sum ${sum ?? "ukjent"} gir etterkontroll, ikke Ferdig`, () => {
      const n = nextInvoiceStep(ni({ ...final, lines_sum_status: sum }));
      expect([n.key, n.enabled]).toEqual(["kontroll_etterkontroll", false]);
      expect(n.hint).not.toMatch(/Summen er kontrollert/);
    });
  }
  it("åpne linjer gir etterkontroll", () => {
    expect(nextInvoiceStep(ni({ ...final, open_count: 1 })).key).toBe("kontroll_etterkontroll");
  });
  it("kreditnota: ukjent godkjenning er ikke Ferdig; kjent godkjent er Ferdig; sum ukjent er etterkontroll", () => {
    expect(nextInvoiceStep(ni({ status: "reconciled", is_credit_note: true, approved: false, costPosted: false, known: false })).key).toBe("status_ukjent");
    expect(nextInvoiceStep(ni({ status: "reconciled", is_credit_note: true, ...extrasFromCounts(true, 0, 2) })).key).toBe("ferdig");
    expect(nextInvoiceStep(ni({ status: "reconciled", is_credit_note: true, lines_sum_status: null, ...extrasFromCounts(true, 0, 2) })).key).toBe("kontroll_etterkontroll");
  });
  it("åpen kreditnota med ukjent status kan fortsatt avstemmes (godkjenning/kost kreves ikke der)", () => {
    expect(nextInvoiceStep(ni({ is_credit_note: true, known: false, approved: false, costPosted: false })).key).toBe("avstem");
  });
});
