import { describe, it, expect } from "vitest";
import { statusLine, autoReconciledPct, sparklinePoints, varekortTodo, fakturaTodo } from "@/ravarer/pages/oversikt/logic";

const emptyDq = {
  missing_package: 0, unconfirmed_package: 0, unstable_price: 0,
  missing_declaration: 0, missing_nutrition: 0, datasheet_changes: 0, active_items: 0,
};

describe("statusLine", () => {
  it("alt kontrollert når todo = 0", () => {
    expect(statusLine({ todo_total: 0, hasInvoiceAccess: true, supplier: null, invoices: null, dq: emptyDq }).headline)
      .toBe("Alt er kontrollert.");
  });
  it("teller varer og fakturaer med bokmål undertekst", () => {
    const r = statusLine({
      todo_total: 804, hasInvoiceAccess: true,
      supplier: { koblet: 0, ukoblet: 354, mangler_pakning: 173, prisavvik: 185, kontroll: 9, ikke_vare: 0 },
      invoices: { open_total: 0, missing_lines: 13, sum_mismatch: 39, needs_review: 0, ready_to_reconcile: 31,
        credit_notes_open: 0, flagged: 0, reconciled_total: 0, reconciled_auto: 0,
        reconciled_7d: 0, reconciled_auto_7d: 0, imported_7d: 0 },
      dq: emptyDq,
    });
    expect(r.headline).toBe("804 ting venter på deg");
    expect(r.sub).toBe("721 varer trenger en beslutning · 83 fakturaer trenger et menneske");
  });
  it("uten fakturatilgang teller datakvalitet", () => {
    expect(statusLine({ todo_total: null, hasInvoiceAccess: false, supplier: null, invoices: null,
      dq: { ...emptyDq, missing_package: 2, missing_declaration: 1 } }).headline)
      .toBe("3 ting å rydde i varedata");
  });
});

describe("autoReconciledPct", () => {
  it("avrunder prosent", () => {
    expect(autoReconciledPct(348, 368)).toBe(95);
    expect(autoReconciledPct(0, 0)).toBe(0);
  });
});

describe("sparklinePoints", () => {
  it("plasserer serie med before + points over bredden", () => {
    const pts = sparklinePoints(100, [{ date: "a", price: 110 }, { date: "b", price: 90 }], 100, 20);
    expect(pts.length).toBe(3);
    expect(pts[0].x).toBe(0);
    expect(pts[2].x).toBe(100);
    expect(pts[1].y).toBe(0); // høyeste pris, øverst
  });
  it("returnerer tom liste med < 2 punkter", () => {
    expect(sparklinePoints(null, [], 100, 20)).toEqual([]);
  });
});

describe("todo-aggregater", () => {
  it("summerer varekort og fakturaer", () => {
    expect(varekortTodo({ koblet: 5, ukoblet: 1, mangler_pakning: 2, prisavvik: 3, kontroll: 4, ikke_vare: 0 })).toBe(10);
    expect(fakturaTodo({ open_total: 0, missing_lines: 1, sum_mismatch: 2, needs_review: 0, ready_to_reconcile: 3,
      credit_notes_open: 0, flagged: 4, reconciled_total: 0, reconciled_auto: 0,
      reconciled_7d: 0, reconciled_auto_7d: 0, imported_7d: 0 })).toBe(10);
  });
});
