import { describe, it, expect } from "vitest";
import { buildDecisionGroups, priceDifference, isSameUnitPrice, materialOptions } from "@/fakturaer/lib/decisionGroups";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

let n = 0;
function line(p: Partial<ReviewLineRow> & { inv: string; supplier?: string }): ReviewLineRow {
  n += 1;
  const { inv, supplier = "s1", ...rest } = p;
  return {
    id: `l${n}`, invoice_id: inv, line_number: 1, supplier_sku: "60241", description: "FLØTE 15% 12x1L",
    quantity: 1, unit: "kartong", unit_price: 504, total_amount: 504, package_size: 12, package_unit: "l",
    count_per_package: null, base_quantity: 12, match_confidence: null, raw_material_id: null,
    price_per_base_unit: 42, expected_price_per_base_unit: null, price_variance_pct: null, variance_status: null,
    review_reason: "unmatched", requires_review: true, price_reference_source: null, price_reference_id: null,
    price_reference_date: null,
    invoice: { id: inv, invoice_number: inv, invoice_date: "2026-10-01", legal_entity_id: "e1", supplier_id: supplier,
      status: "needs_review", source: "tripletex", currency: "NOK", is_credit_note: false, source_document_url: null,
      total_amount: 0, total_vat: 0, lines_sum_status: null, lines_sum_excl_vat: null, lines_sum_variance_pct: null,
      extraction_confidence: null, supplier: { name: "Nordmat", contact_email: null }, legal_entity: null },
    suggestions: [
      { raw_material_id: "rmA", confidence: 0.9, match_reason: null, rank: 1, raw_material: { name: "Matfløte 15 %", sku: null, category: "Meieri", current_cost_price: null, base_unit: "l" } },
      { raw_material_id: "rmB", confidence: 0.88, match_reason: null, rank: 2, raw_material: { name: "Matfløte 15 %, laktosefri", sku: null, category: "Meieri", current_cost_price: null, base_unit: "l" } },
    ],
    ...rest,
  };
}

describe("decisionGroups", () => {
  it("A: samme vare og pakning på tre fakturaer blir ett spørsmål", () => {
    const g = buildDecisionGroups([line({ inv: "F1" }), line({ inv: "F2" }), line({ inv: "F3" })]);
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe("material");
    expect(g[0].invoiceIds).toEqual(["F1", "F2", "F3"]);
    expect(g[0].shared).toBe(true);
    expect(materialOptions(g[0]).map((o) => o.id)).toEqual(["rmA", "rmB"]);
  });

  it("slår ikke sammen ulik pakning, ulik leverandør eller linjer uten varenummer", () => {
    const g = buildDecisionGroups([
      line({ inv: "F1" }),
      line({ inv: "F2", package_size: 15 }),
      line({ inv: "F3", supplier: "s2" }),
      line({ inv: "F4", supplier_sku: null }),
      line({ inv: "F5", supplier_sku: null }),
    ]);
    expect(g).toHaveLength(5);
    expect(g.filter((x) => !x.shared)).toHaveLength(2);
  });

  it("konflikt står alltid alene", () => {
    const g = buildDecisionGroups([line({ inv: "F1", review_reason: "sku_collision" }), line({ inv: "F2", review_reason: "sku_collision" })]);
    expect(g).toHaveLength(2);
  });

  it("ferdige og ikke-råvare linjer gir ingen beslutning", () => {
    const g = buildDecisionGroups([line({ inv: "F1", match_confidence: "not_applicable" })]);
    expect(g).toHaveLength(0);
  });

  it("B: samme prisavvik på to melfakturaer: ett spørsmål, 3000 kr ekskl. mva", () => {
    const mel = (inv: string) =>
      line({ inv, supplier_sku: "M-24", description: "Hvetemel 25 kg", raw_material_id: "rmMel", match_confidence: "manual",
        review_reason: "price_increase", price_per_base_unit: 31.2, expected_price_per_base_unit: 30, base_quantity: 1250 });
    const g = buildDecisionGroups([mel("M-7301"), mel("M-7302")]);
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe("price");
    expect(g[0].differenceExclVat).toBe(3000);
  });

  it("gjetter aldri mengde: ukjent grunnmengde gir ukjent forskjell", () => {
    expect(priceDifference({ price_per_base_unit: 31.2, expected_price_per_base_unit: 30, base_quantity: null })).toBeNull();
  });

  it("C: 6×1L 138 kr og 8×1L 184 kr har samme literpris", () => {
    expect(isSameUnitPrice(138 / 6, 184 / 8)).toBe(true);
  });
});
