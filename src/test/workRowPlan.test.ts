import { describe, expect, it } from "vitest";
import { buildReviewPlan, rowPlanSummary, supplierBasis, basisNextAction } from "@/fakturaer/lib/reviewPlan";
import { unitCorrectionState, unitCorrectionOptions } from "@/fakturaer/lib/unitCorrection";
import { parseWorkItemPlans } from "@/ravarer/hooks/useWorkItemPlans";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const base: SupplierItemLine = {
  id: "l1", invoice_id: "i1", invoice_number: "DEMO1042", invoice_date: "2026-01-02", invoice_status: "needs_review", flagged_at: null,
  is_credit_note: false, reconciled_mode: null, line_number: 1, supplier_sku: "T1", description: "Testvare pose 100g", quantity: 10, unit: "pose",
  unit_price: 120, total_amount: 950, package_size: 100, package_unit: "g", count_per_package: null, base_quantity: 1, price_per_base_unit: 950,
  expected_price_per_base_unit: null, price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: "rm1",
  raw_material_name: "Testvare", match_confidence: "high", requires_review: true, review_reason: "no_baseline", resolution_note: null,
  created_at: null, line_kind: "vare", cost_posted: false, in_price_history: false, price_context: true, discount_amount: 250,
  unit_price_basis: "mengdeenhet", extraction_issues: [], line_updated_at: "2026-01-02T10:00:00.123456+00:00", rm_base_unit: "kg", invoice_approved: false,
};
const item = { rm_id: "rm1", rm_base_unit: "kg", package_confirmed_at: null, base_units_per_package: null, rm_cost: null, status: "koblet" };

describe("arbeidslistens rad bruker samme plan", () => {
  it("åpen linje gir planens handling", () => {
    expect(rowPlanSummary([base], 1, null)?.next).toBe("Bekreft første pris");
  });
  it("godkjent faktura: åpne for nykontroll, aldri bekreft pakning", () => {
    const s = rowPlanSummary([{ ...base, invoice_approved: true, review_reason: "unknown_package_size" }], 1, null);
    expect(s?.readonly).toBe(true);
    expect(s?.next).toMatch(/Åpne faktura for nykontroll/);
  });
  it("ukjent grunnlag gir null (serverens tekst), aldri grønt", () => {
    expect(rowPlanSummary([], 3, null)).toBeNull();
    expect(rowPlanSummary(undefined, null, null)).toBeNull();
    expect(parseWorkItemPlans(null).size).toBe(0);
    expect(parseWorkItemPlans({ "a|b": { open_lines: null, lines: [] } }).get("a|b")?.openLines).toBeNull();
  });
});

describe("linjekontroll skilt fra leverandørgrunnlag", () => {
  it("0 åpne men pakning/kost mangler er ikke ferdig", () => {
    const l = { ...base, requires_review: false, base_quantity: null };
    const plan = buildReviewPlan(item, [l]);
    const rows = supplierBasis(item, plan, [l]);
    expect(rows.find((r) => r.key === "linjer")?.state).toBe("ok");
    expect(rows.find((r) => r.key === "pakning")?.state).toBe("todo");
    expect(rows.find((r) => r.key === "kost")?.state).toBe("todo");
    expect(basisNextAction(rows)?.kind).toBe("pakning");
  });
  it("ukjent kost er ukjent", () => {
    const plan = buildReviewPlan(item, []);
    expect(supplierBasis({ ...item, rm_cost: undefined, package_confirmed_at: "x" }, plan, []).find((r) => r.key === "kost")?.state).toBe("unknown");
  });
});

describe("rett fakturert enhet", () => {
  const ok = { before: "sekk", after: "pose", reason: "Originalen viser poser", costPosted: false, loading: false, loadError: false, unknown: false };
  it("bare enhet + begrunnelse", () => { expect(unitCorrectionState(ok)).toEqual({ kind: "ready", after: "pose" }); });
  it("sperrer ukjent utfall, kost ført, lik enhet, manglende begrunnelse/versjon", () => {
    expect(unitCorrectionState({ ...ok, unknown: true }).kind).toBe("blocked");
    expect(unitCorrectionState({ ...ok, costPosted: true }).kind).toBe("blocked");
    expect(unitCorrectionState({ ...ok, after: "Sekk" }).kind).toBe("blocked");
    expect(unitCorrectionState({ ...ok, reason: "" }).kind).toBe("blocked");
    expect(unitCorrectionState({ ...ok, before: null }).kind).toBe("blocked");
  });
  it("tilbyr pose når linjen er sekk", () => { expect(unitCorrectionOptions("sekk")).toContain("pose"); expect(unitCorrectionOptions("sekk")).not.toContain("sekk"); });
});
