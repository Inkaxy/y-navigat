import { describe, expect, it } from "vitest";
import { buildReviewPlan } from "@/fakturaer/lib/reviewPlan";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const l = {
  id: "00000000-0000-4000-8000-000000000101", invoice_id: "00000000-0000-4000-8000-000000001042", invoice_number: "DEMO1042", invoice_date: "2026-01-15",
  invoice_status: "needs_review", flagged_at: null, is_credit_note: false, line_number: 1, description: "Testvare pose 100g", quantity: 10, unit: "pose",
  unit_price: 120, total_amount: 950, discount_amount: 250, unit_price_basis: "pakning", price_context: true, extraction_issues: [], requires_review: true,
  review_reason: null, raw_material_id: "rm", match_confidence: "manual", rm_base_unit: "kg", package_size: 100, package_unit: "g", count_per_package: null, line_kind: null,
} as unknown as SupplierItemLine;
const item = { rm_id: "rm", rm_base_unit: "kg", package_confirmed_at: null, base_units_per_package: null };
const step = (ls: SupplierItemLine[], k: string) => buildReviewPlan(item, ls).steps.find((s) => s.key === k)!;

describe("gjennomgangsplan: ingen falskt grønt", () => {
  it("manglende tall gir prisgrunnlag å avklare, ikke ok", () => {
    expect(step([{ ...l, total_amount: null } as unknown as SupplierItemLine], "prisgrunnlag").state).toBe("todo");
  });
  it("rabatt som går opp er ok; rabatt som ikke går opp er todo", () => {
    expect(step([l], "prisgrunnlag").state).toBe("ok");
    expect(step([{ ...l, discount_amount: 100 }], "prisgrunnlag").state).toBe("todo");
  });
  it("requires_review null er ukjent, aldri ferdig", () => {
    const p = buildReviewPlan(item, [{ ...l, requires_review: null as unknown as boolean }]);
    expect(p.steps.find((s) => s.key === "kontrollert")!.state).toBe("unknown");
    expect(p.incomplete).toBe(true);
  });
  it("stk-vare med 100 g pose: rett varetype, aldri «Bekreft 100 g pose»", () => {
    const p = buildReviewPlan(item, [{ ...l, rm_base_unit: "stk", review_reason: "unknown_package_size" }]);
    expect(p.primary?.label).toBe("Rett varetype og måleenhet");
  });
  it("holdt utenfor/ikke-vare gjenopplives ikke som oppgave", () => {
    const p = buildReviewPlan(item, [{ ...l, invoice_status: "excluded" }, { ...l, id: "x2", match_confidence: "not_applicable" }]);
    expect(p.openLines).toBe(0); expect(p.primary).toBeNull(); expect(p.perInvoice).toEqual([]);
  });
});
