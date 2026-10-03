import { describe, expect, it } from "vitest";
import { batchMatchTargets } from "@/fakturaer/components/inbox/InvoiceInbox";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { lineStatus, type LineStatusInput } from "@/fakturaer/lib/lineStatus";

function inv(id: string, number: string, tab: InboxInvoice["tab"]): InboxInvoice {
  return { id, invoice_number: number, supplier_name: "ASKO", tab, status: "needs_review", line_count: 3 } as unknown as InboxInvoice;
}

describe("Oppdater matching følger søk og fane", () => {
  const all = [inv("a", "330702353", "open"), ...Array.from({ length: 684 }, (_, i) => inv(`x${i}`, `9${i}`, "open"))];
  it("søketreff 1 → bare den ene fakturaen sendes", () => {
    expect(batchMatchTargets(all, "330702353", "open").map((i) => i.id)).toEqual(["a"]);
  });
  it("uten søk → bare aktiv fane", () => {
    expect(batchMatchTargets([...all, inv("r", "1", "ready")], "", "ready").map((i) => i.id)).toEqual(["r"]);
    expect(batchMatchTargets(all, "", "done")).toEqual([]);
  });
});

describe("Frivillig startprisforslag gjør ikke linjen uavklart", () => {
  const line = {
    id: "smoremyk",
    raw_material_id: "rm",
    match_confidence: "manual",
    requires_review: false,
    review_reason: null,
    review_reasons: [],
    price_per_base_unit: 42,
  } as unknown as LineStatusInput;
  it("samme status med og uten kandidater", () => {
    const before = lineStatus(line, new Set());
    const after = lineStatus(line, new Set(["smoremyk"]));
    expect(after.key).toBe("ready");
    expect(after.bucket).toBe(before.bucket);
  });
  it("ekte blokkere består", () => {
    const blocked = { ...line, requires_review: true, review_reasons: ["price_variance"] } as LineStatusInput;
    expect(lineStatus(blocked, new Set(["smoremyk"])).bucket).toBe("needs");
  });
});

import { assessInboxInvoice } from "@/fakturaer/lib/inbox";

describe("Fakturanivåavvik skilt fra linjene", () => {
  const known = {
    id: "karamell",
    raw_material_id: "rm",
    match_confidence: "manual",
    requires_review: false,
    review_reason: null,
    price_per_base_unit: 121.41,
    price_variance_pct: null,
    variance_status: null,
    category: null,
    quantity: 6,
  };
  for (const [name, invoice] of [
    ["sumavvik", { lines_sum_status: "mismatch", extraction_confidence: 0.95 }],
    ["lavt uttrekk", { lines_sum_status: "ok", extraction_confidence: 0.4 }],
  ] as const) {
    it(`${name}: bekreftet linje er klar, fakturaen sperret med én fakturaoppgave`, () => {
      expect(lineStatus({ ...known, invoice } as unknown as LineStatusInput).bucket).toBe("ready");
      const a = assessInboxInvoice({
        status: "needs_review",
        is_credit_note: false,
        lines_sum_status: invoice.lines_sum_status,
        extraction_confidence: invoice.extraction_confidence,
        currency: "NOK",
        lines: [{ ...known, invoice }],
      });
      expect(a.openCount).toBe(0);
      expect(a.canReconcile).toBe(false);
      expect(a.invoiceLevelIssues).toHaveLength(1);
    });
  }
});

import { lineIsOpen } from "@/fakturaer/lib/inbox";

describe("Innboks og fokus teller likt", () => {
  const base = { raw_material_id: "rm", match_confidence: "manual", requires_review: false, review_reason: null, price_per_base_unit: 10, price_variance_pct: null, variance_status: null, category: null, quantity: 1 };
  const cases = [
    { ...base, id: "a" },
    { ...base, id: "smoremyk" },
    { ...base, id: "b", requires_review: true, review_reason: "price_variance" },
    { ...base, id: "c", match_confidence: "auto_low" },
    { ...base, id: "d", price_per_base_unit: null },
    { ...base, id: "e", invoice: { lines_sum_status: "mismatch", extraction_confidence: 0.4 } },
  ];
  it("samme åpne antall med startpriskandidater lastet", () => {
    const inbox = cases.filter(lineIsOpen).length;
    const focus = cases.filter((l) => lineStatus(l as unknown as LineStatusInput, new Set(["smoremyk"])).bucket === "needs").length;
    expect(inbox).toBe(3);
    expect(focus).toBe(inbox);
  });
});

import { invoiceArithmeticMismatch, resolveLineCost } from "@/fakturaer/lib/units";

describe("Regneavvik vs ukjent pakning", () => {
  it("KARAMELLSIRUP 6 flaske × 121,41 = 728,46 med ukjent pakning: ingen advarsel, pakning gjenstår", () => {
    const line = { quantity: 6, unitPrice: 121.41, totalAmount: 728.46 };
    const cost = resolveLineCost({ ...line, unit: "flaske", baseUnit: "l", description: "KARAMELLSIRUP MONIN" });
    expect(cost.needsInput).toBeTruthy();
    expect(invoiceArithmeticMismatch(line, cost.checks)).toBe(false);
  });
  it("Oatly 6 × 23,69 mot 1279,26: advarsel", () => {
    expect(invoiceArithmeticMismatch({ quantity: 6, unitPrice: 23.69, totalAmount: 1279.26 }, null)).toBe(true);
  });
  it("forklart av kjent pakning eller manglende tall: ingen advarsel", () => {
    expect(invoiceArithmeticMismatch({ quantity: 2, unitPrice: 10, totalAmount: 240 }, { arithmeticPerBaseUnit: true })).toBe(false);
    expect(invoiceArithmeticMismatch({ quantity: 2, unitPrice: null, totalAmount: 240 }, null)).toBe(false);
  });
});
