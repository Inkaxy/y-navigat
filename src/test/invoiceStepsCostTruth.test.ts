import { describe, expect, it } from "vitest";
import { costProgress, deliverySteps, extrasFromCounts, nextInvoiceStep, NOT_DONE_KEYS, type NextStepInput } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import { arbeidClassOf } from "@/ravarer/pages/priskontroll/arbeid/arbeidLogic";

const ni = (o: Partial<NextStepInput>): NextStepInput => ({
  status: "ready", received_at: null, line_count: 3, lines_source: null, line_extraction_status: "done", open_count: 0,
  lines_sum_status: "ok", source: "tripletex", canReconcile: true, reconcileBlockedReason: null,
  canWrite: true, canReconcileRight: true, canApprove: true, canPostCosts: true,
  ...extrasFromCounts(false, 0, 3), ...o,
});

describe("hovedflyten påstår aldri ferdig kost ved 0 eller delvis føring", () => {
  it("avstemt+godkjent med 0 av 3 ført er etterkontroll, ikke Ferdig", () => {
    const n = nextInvoiceStep(ni({ status: "reconciled", ...extrasFromCounts(true, 0, 3) }));
    expect(n.key).toBe("kost_etterkontroll");
    expect(n.label).toContain("0 av 3");
    expect(NOT_DONE_KEYS).toContain(n.key);
  });
  it("delvis ført viser eksakt ført/totalt", () => {
    const n = nextInvoiceStep(ni({ status: "reconciled", ...extrasFromCounts(true, 2, 3) }));
    expect([n.key, n.label]).toEqual(["kost_etterkontroll", "Kostpris delvis ført – 2 av 3 varelinjer ført"]);
  });
  it("full føring + avstemt + godkjent er Ferdig", () => {
    const n = nextInvoiceStep(ni({ status: "reconciled", ...extrasFromCounts(true, 3, 3) }));
    expect(n.key).toBe("ferdig");
    expect(deliverySteps(ni({ status: "reconciled" }), extrasFromCounts(true, 3, 3)).every((s) => s.done)).toBe(true);
  });
  it("ingen trygge linjer på åpen faktura er kontrollbehov, ikke avstem/ferdig", () => {
    const n = nextInvoiceStep(ni({ ...extrasFromCounts(false, 1, 3), noSafeLines: true }));
    expect(n.key).toBe("kostkontroll");
    expect(n.label).toContain("1 av 3");
    expect(n.enabled).toBe(true);
  });
  it("avstemt uten godkjenning: Venter intern godkjenning når brukeren ikke kan godkjenne", () => {
    const n = nextInvoiceStep(ni({ status: "reconciled", canApprove: false, ...extrasFromCounts(false, 3, 3) }));
    expect([n.key, n.label, n.enabled]).toEqual(["venter_godkjenning", "Venter intern godkjenning", false]);
    expect(nextInvoiceStep(ni({ status: "reconciled", ...extrasFromCounts(false, 3, 3) })).key).toBe("godkjenn");
  });
  it("ukjent status (lasting/feil) er aldri ferdig og gir ingen handling", () => {
    for (const status of ["ready", "reconciled"]) {
      const n = nextInvoiceStep(ni({ status, approved: false, costPosted: false, known: false }));
      expect([n.key, n.enabled]).toEqual(["status_ukjent", false]);
    }
  });
  it("kreditnota: kost ikke relevant (ikke 0), og ingen varelinjer gir ikke falsk mangel", () => {
    expect(nextInvoiceStep(ni({ status: "reconciled", is_credit_note: true, approved: true, costPosted: false, known: false })).key).toBe("status_ukjent");
    expect(nextInvoiceStep(ni({ status: "reconciled", is_credit_note: true, ...extrasFromCounts(true, 0, 3) })).key).toBe("ferdig");
    expect(costProgress(0, 0).state).toBe("fullfort");
    expect(nextInvoiceStep(ni({ status: "reconciled", ...extrasFromCounts(true, 0, 0) })).key).toBe("ferdig");
  });
  it("arbeidsklassen «ferdig» betyr bare avstemt; kvitteringen påstår ikke mer", () => {
    expect(arbeidClassOf("reconciled", false)).toBe("ferdig");
  });
});
