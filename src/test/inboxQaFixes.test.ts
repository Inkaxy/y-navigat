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
    expect(lineStatus(blocked, new Set(["smoremyk"])).key).toBe("review_price");
  });
});
