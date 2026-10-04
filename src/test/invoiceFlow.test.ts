import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { approvalBucket, approveMany, summarizeResults, amountExclVat } from "@/fakturaer/lib/approval";
import { remainingByInvoice, maxAllocatable } from "@/fakturaer/lib/supplierCases";
import { runPerLine, packagePreview } from "@/fakturaer/lib/groupActions";
import { buildDecisionGroups } from "@/fakturaer/lib/decisionGroups";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

const L = (id: string, inv: string, extra: Partial<ReviewLineRow> = {}) => ({
  id, invoice_id: inv, line_number: 1, supplier_sku: "60241", description: "Fløte", quantity: 1, unit: "kartong",
  unit_price: 504, total_amount: 504, package_size: 12, package_unit: "l", count_per_package: null, base_quantity: 12,
  match_confidence: "manual", raw_material_id: "rm1", price_per_base_unit: 42, expected_price_per_base_unit: null,
  price_variance_pct: null, variance_status: null, review_reason: "no_automatic_basis", requires_review: true,
  price_reference_source: null, price_reference_id: null, price_reference_date: null,
  invoice: { id: inv, invoice_number: inv, invoice_date: "2026-10-01", legal_entity_id: "e", supplier_id: "s", status: "needs_review",
    source: null, currency: "NOK", is_credit_note: false, source_document_url: null, total_amount: 0, total_vat: 0, lines_sum_status: "ok",
    lines_sum_excl_vat: null, lines_sum_variance_pct: null, extraction_confidence: null, supplier: { name: "Nordmat", contact_email: null }, legal_entity: null },
  suggestions: [], matched_raw_material: { name: "Matfløte", sku: null, category: null, base_unit: "l" }, ...extra,
}) as ReviewLineRow;

describe("intern godkjenning", () => {
  it("D: råvarevalg alene sperrer ikke — bare servernes sperrer avgjør", () => {
    expect(approvalBucket({ approved_at: null, blockers: [] })).toBe("ready");
    expect(approvalBucket({ approved_at: null, blockers: ["sumavvik"] })).toBe("waiting");
    expect(approvalBucket({ approved_at: "2026-10-04", blockers: [] })).toBe("done");
  });
  it("rapporterer nøyaktig delvis resultat, aldri «lagret for alle»", async () => {
    const res = await approveMany(["a", "b", "c"], null, async (id) => ({ invoiceId: id, ok: id !== "b", already: false, message: id === "b" ? "Sumavvik" : null }));
    expect(summarizeResults(res).text).toBe("2 av 3 lagret, 1 feilet");
  });
  it("beløp ekskl. mva fra lagret total og mva", () => {
    expect(amountExclVat(3450, 450)).toBe(3000);
  });
});

describe("B: delkreditering per faktura", () => {
  const lines = [{ invoice_id: "M-7301", amount_excl_vat: 1500 }, { invoice_id: "M-7302", amount_excl_vat: 1500 }];
  it("første kredit 1725 inkl. (1500 ekskl.) gjelder bare første faktura", () => {
    const rem = remainingByInvoice(lines, [{ invoice_id: "M-7301", amount_excl_vat: 1500 }]);
    expect(rem.get("M-7301")).toBe(0);
    expect(rem.get("M-7302")).toBe(1500);
  });
  it("kan ikke overfordele kreditnota eller restavvik", () => {
    expect(maxAllocatable(1500, 1500)).toBe(1500);
    expect(maxAllocatable(200, 1500)).toBe(200);
    expect(maxAllocatable(1500, 0)).toBe(0);
  });
});

describe("gruppelagring og pakning", () => {
  it("per-linje-lagring teller feil ærlig", async () => {
    const r = await runPerLine([L("1", "F1"), L("2", "F2")], async (l) => { if (l.id === "2") throw new Error("avvist"); });
    expect(r.text).toBe("1 av 2 lagret, 1 feilet");
    expect(r.outcomes[1].message).toBe("avvist");
  });
  it("C: 8×1L til 184 kr gir 23 kr/l — mengde fra dokumentert innhold, ikke linjesum/pris", () => {
    expect(packagePreview({ quantity: 1, total_amount: 184 }, 8)).toEqual({ baseQuantity: 8, pricePerBase: 23 });
    expect(packagePreview({ quantity: null, total_amount: 184 }, 8)).toBeNull();
  });
  it("manglende avtalepris alene blir første kostpris, ikke prisavvik", () => {
    const g = buildDecisionGroups([L("1", "F1"), L("2", "F2")]);
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe("first_cost");
  });
});
