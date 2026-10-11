import { describe, expect, it } from "vitest";
import { shouldOpenEditMaterial } from "@/fakturaer/lib/editMaterialSignal";
import { flagSummary, isFlaggable } from "@/fakturaer/lib/flagging";
import { bulkActionGate } from "@/ravarer/pages/priskontroll/godkjenning/approvalLogic";
import { canFetchLines, nextInvoiceStep, deliverySteps, type NextStepInput } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import { fakturaBackHref, readReturnParam } from "@/ravarer/pages/priskontroll/fakturaer/visning";
import { workspaceKey, type WorkspaceKeys } from "@/ravarer/pages/priskontroll/faktura/useWorkspaceHotkeys";
import { chipCount } from "@/ravarer/pages/priskontroll/fakturaer/VisningChips";
import { invoiceQueryKeys } from "@/ravarer/lib/invalidate";

const base: NextStepInput = {
  status: "reconciled", received_at: null, line_count: 3, lines_source: null, line_extraction_status: "done", open_count: 0,
  lines_sum_status: "ok", approved: true, costPosted: false, source: "tripletex", canReconcile: true, reconcileBlockedReason: null,
  canWrite: true, canReconcileRight: true, canApprove: false,
};

describe("R0: kostpris krever skrivetilgang, godkjenning krever approve/admin", () => {
  it("massehandlinger", () => {
    expect(bulkActionGate({ canApprove: false, canWrite: true })).toMatchObject({ approve: false, costs: true, costsReason: null });
    expect(bulkActionGate({ canApprove: true, canWrite: false })).toMatchObject({ approve: true, costs: false });
  });
  it("headeren: «Før kostpris» følger canPostCosts, ikke canApprove", () => {
    expect(nextInvoiceStep({ ...base, canPostCosts: true }).enabled).toBe(true);
    expect(nextInvoiceStep({ ...base, canPostCosts: false }).enabled).toBe(false);
  });
});

describe("A1: avstemte fakturaer kan ikke flagges", () => {
  it("statusfilter og melding", () => {
    expect(isFlaggable("reconciled")).toBe(false);
    expect(isFlaggable("flagged")).toBe(false);
    expect(isFlaggable("needs_review")).toBe(true);
    expect(flagSummary(5, 3).text).toContain("2 hoppet over");
  });
});

describe("A2: «Endre råvare»-signalet er linjebundet", () => {
  it("åpner bare for linjen signalet gjelder, og bare én gang", () => {
    const sig = { lineId: "a", n: 1 };
    expect(shouldOpenEditMaterial(sig, "a", null)).toBe(true);
    expect(shouldOpenEditMaterial(sig, "b", null)).toBe(false); // senere linjer som monteres
    expect(shouldOpenEditMaterial(sig, "a", 1)).toBe(false);
    expect(shouldOpenEditMaterial(null, "a", null)).toBe(false);
  });
});

describe("A3/småting: hurtigtaster", () => {
  const keys = (canWrite: boolean, calls: string[]): WorkspaceKeys => ({
    enabled: true, canWrite, activeLine: { id: "l1" } as WorkspaceKeys["activeLine"],
    next: () => calls.push("next"), prev: () => undefined, enter: () => calls.push("enter"), editMaterial: () => calls.push("m"),
    create: () => calls.push("n"), notItem: () => calls.push("x"), undo: () => undefined, toggleDoc: () => undefined, escape: () => undefined, help: () => undefined,
  });
  it("N/X/M/Enter gjør ingenting uten skrivetilgang (låst faktura)", () => {
    const calls: string[] = [];
    for (const k of ["n", "x", "m", "Enter"]) workspaceKey(new KeyboardEvent("keydown", { key: k }), keys(false, calls));
    expect(calls).toEqual([]);
  });
  it("virker inne i inspektørens Sheet, men ikke i felt", () => {
    const calls: string[] = [];
    const sheet = document.createElement("div");
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("data-inspector-sheet", "");
    const btn = document.createElement("div"); sheet.appendChild(btn);
    const input = document.createElement("input"); sheet.appendChild(input);
    document.body.appendChild(sheet);
    const ev = (t: HTMLElement) => { const e = new KeyboardEvent("keydown", { key: "j" }); Object.defineProperty(e, "target", { value: t }); return e; };
    workspaceKey(ev(btn), keys(true, calls));
    workspaceKey(ev(input), keys(true, calls));
    expect(calls).toEqual(["next"]);
  });
});

describe("B5: returparameter kolliderer ikke med datofilteret", () => {
  it("leser retur, og gammel fra bare når den ikke er en dato", () => {
    expect(readReturnParam(new URLSearchParams("retur=%3Fvisning%3Dklar"))).toBe("?visning=klar");
    expect(readReturnParam(new URLSearchParams("fra=2026-01-01"))).toBeNull();
    expect(readReturnParam(new URLSearchParams("fra=%3Fvisning%3Dalle"))).toBe("?visning=alle");
  });
  it("beholder Fra-datofilteret i tilbakelenken", () => {
    expect(fakturaBackHref("?fane=fakturaer&fra=2026-01-01")).toBe("/ravarer/priskontroll?fane=fakturaer&fra=2026-01-01");
  });
});

describe("B9/B11/B13/B14", () => {
  it("«Klare»-tallet er listens tall", () => {
    expect(chipCount("klar", { klar: 4, inv: { ready_to_reconcile: 9 } as never, alle: null })).toBe(4);
  });
  it("kreditnota: kostpris ikke relevant; ingen trygge linjer gir Ferdig", () => {
    expect(nextInvoiceStep({ ...base, is_credit_note: true }).key).toBe("ferdig");
    expect(deliverySteps({ ...base, is_credit_note: true }, { approved: true, costPosted: false }).find((s) => s.key === "kostpris")?.done).toBe(true);
    expect(nextInvoiceStep({ ...base, canPostCosts: true, noSafeLines: true }).key).toBe("ferdig");
  });
  it("kreditnota uten kobling: «Koble kreditnota» er primærsteg", () => {
    expect(nextInvoiceStep({ ...base, status: "needs_review", is_credit_note: true, creditNoteUnlinked: true }).key).toBe("koble_kreditnota");
  });
  it("«Hent linjer» bare når linjene ikke er lest", () => {
    expect(canFetchLines({ source: "tripletex", line_extraction_status: "done" })).toBe(false);
    expect(canFetchLines({ source: "tripletex", line_extraction_status: "failed" })).toBe(true);
  });
  it("listene invalideres etter fakturahandlinger", () => {
    const k = invoiceQueryKeys().map((x) => x[0]);
    expect(k).toContain("fakturaer-liste");
    expect(k).toContain("invoice-delivery-status");
  });
});
