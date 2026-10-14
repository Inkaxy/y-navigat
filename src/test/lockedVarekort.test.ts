import { describe, expect, it } from "vitest";
import { lockedOpenLines } from "@/ravarer/pages/priskontroll/gjore/VarekortPanel";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const l = (o: Partial<SupplierItemLine>) => ({ id: "L1", invoice_id: "I1", invoice_number: "DEMO1042", requires_review: true, invoice_approved: false, cost_posted: false, ...o }) as SupplierItemLine;

describe("lockedOpenLines", () => {
  it("låser når eneste åpne linje er internt godkjent", () => {
    const r = lockedOpenLines([l({ invoice_approved: true }), l({ id: "L2", requires_review: false })]);
    expect(r?.badge).toBe("Internt godkjent – låst");
    expect(r?.lineId).toBe("L1");
  });
  it("ikke låst når én åpen linje er skrivbar", () => {
    expect(lockedOpenLines([l({ invoice_approved: true }), l({ id: "L2" })])).toBeNull();
  });
  it("ikke låst uten åpne linjer", () => {
    expect(lockedOpenLines([l({ requires_review: false, invoice_approved: true })])).toBeNull();
  });
  it("ført kostpris låser også", () => {
    expect(lockedOpenLines([l({ cost_posted: true })])?.badge).toBe("Låst for endring");
  });
});
