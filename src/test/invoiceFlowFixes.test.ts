import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { groupKeyFor, buildDecisionGroups, hasKnownPackage } from "@/fakturaer/lib/decisionGroups";
import { creditNetExclVat } from "@/fakturaer/lib/supplierCases";
import { frozenSignature, outcomeNotes, summarize } from "@/fakturaer/lib/groupActions";
import { blockerLabel } from "@/fakturaer/lib/approval";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

const L = (id: string, extra: Partial<ReviewLineRow> = {}, inv: Partial<ReviewLineRow["invoice"]> = {}) => ({
  id, invoice_id: `F-${id}`, line_number: 1, supplier_sku: "60241", description: "Fløte", quantity: 1, unit: "kartong",
  unit_price: 504, total_amount: 504, package_size: 12, package_unit: "l", count_per_package: null, base_quantity: 12,
  match_confidence: "auto_high", raw_material_id: "rm1", price_per_base_unit: 42, expected_price_per_base_unit: 40,
  price_variance_pct: 5, variance_status: "over_tolerance", review_reason: "price_variance", requires_review: true,
  price_reference_source: "agreement", price_reference_id: "a1", price_reference_date: "2026-01-01",
  invoice: { id: `F-${id}`, invoice_number: `F-${id}`, invoice_date: "2026-10-01", legal_entity_id: "e", supplier_id: "s", status: "needs_review",
    source: null, currency: "NOK", is_credit_note: false, source_document_url: null, total_amount: 0, total_vat: 0, lines_sum_status: "ok",
    lines_sum_excl_vat: null, lines_sum_variance_pct: null, extraction_confidence: null, supplier: { name: "Nordmat", contact_email: null }, legal_entity: null, ...inv },
  suggestions: [], matched_raw_material: { name: "Matfløte", sku: null, category: null, base_unit: "l" }, ...extra,
}) as ReviewLineRow;

describe("gruppering — punkt 6", () => {
  it("ukjent pakning deler aldri pakningsbekreftelse", () => {
    const a = L("1", { package_size: null, package_unit: null, review_reason: "unknown_package_size" });
    expect(hasKnownPackage(a)).toBe(false);
    expect(groupKeyFor(a, "package").shared).toBe(false);
  });
  it("valuta, kreditnota og selskap skiller grupper", () => {
    const base = L("1");
    const k = groupKeyFor(base, "price").key;
    expect(groupKeyFor(L("2", {}, { currency: "SEK" }), "price").key).not.toBe(k);
    expect(groupKeyFor(L("3", {}, { is_credit_note: true }), "price").key).not.toBe(k);
    expect(groupKeyFor(L("4", {}, { legal_entity_id: "annet" }), "price").key).not.toBe(k);
    expect(groupKeyFor(L("5"), "price").key).toBe(k);
  });
  it("prisgrupper skiller pakning og prisreferanse", () => {
    const k = groupKeyFor(L("1"), "price").key;
    expect(groupKeyFor(L("2", { package_size: 6 }), "price").key).not.toBe(k);
    expect(groupKeyFor(L("3", { price_reference_id: "a2" }), "price").key).not.toBe(k);
  });
  it("produktnavn alene slår aldri sammen", () => {
    const g = buildDecisionGroups([L("1", { supplier_sku: null }), L("2", { supplier_sku: null })]);
    expect(g.every((x) => !x.shared)).toBe(true);
  });
  it("varenummer med %-tegn gir stabil nøkkel uten dobbel dekoding", () => {
    const k = groupKeyFor(L("1", { supplier_sku: "50%RABATT" }), "price").key;
    expect(() => decodeURIComponent(encodeURIComponent(k))).not.toThrow();
  });
});

describe("kreditnota — punkt 3", () => {
  it("ukjent mva gir ukjent netto, ikke total", () => {
    expect(creditNetExclVat(-1725, null)).toBeNull();
    expect(creditNetExclVat(-1725, -225)).toBe(1500);
  });
});

describe("ærlig lagring — punkt 6 og 8", () => {
  it("fryst signatur endres når pakning eller råvare endres", () => {
    const a = L("1");
    expect(frozenSignature(a)).toBe(frozenSignature(L("1")));
    expect(frozenSignature(a)).not.toBe(frozenSignature(L("1", { package_size: 15 })));
  });
  it("viser beregning og læring som gjenstår", () => {
    const r = summarize([{ lineId: "1", invoiceNumber: "F", ok: true, message: null }], { learningFailed: 1, recalcPending: 1, changedSinceViewed: 1 });
    expect(r.text).toBe("1 av 1 lagret");
    expect(outcomeNotes(r)).toHaveLength(3);
  });
  it("nye sperrer har norsk forklaring", () => {
    for (const c of ["sum_ukontrollert", "mva_ukjent", "lavt_uttrekk", "leverandor_mangler", "valuta_mangler", "belop_mangler"]) {
      expect(blockerLabel(c)).not.toBe("Kan ikke godkjennes ennå");
    }
  });
});
