import { describe, it, expect } from "vitest";
import { primaryActionFor } from "@/fakturaer/lib/queuePrimaryAction";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

/**
 * Hovedhandlingen i fakturakøen. Testene bruker de FAKTISKE årsakskodene
 * matchemotoren skriver, ikke forkortede varianter.
 */
function line(over: Partial<ReviewLineRow>): ReviewLineRow {
  return {
    id: "l1",
    invoice_id: "i1",
    line_number: 1,
    supplier_sku: "SKU",
    description: "Hvetemel 25 kg",
    quantity: 2,
    unit: "sekk",
    unit_price: 300,
    total_amount: 600,
    package_size: 25,
    package_unit: "kg",
    count_per_package: null,
    base_quantity: 50,
    match_confidence: null,
    raw_material_id: null,
    price_per_base_unit: 12,
    expected_price_per_base_unit: 12,
    price_variance_pct: 0,
    variance_status: "within_tolerance",
    review_reason: null,
    requires_review: true,
    price_reference_source: "agreement",
    price_reference_id: null,
    price_reference_date: null,
    invoice: {
      id: "i1",
      invoice_number: "F-1",
      invoice_date: "2026-09-01",
      legal_entity_id: "e1",
      supplier_id: "s1",
      status: "needs_review",
      source: "ehf",
      currency: "NOK",
      is_credit_note: false,
      source_document_url: null,
      total_amount: 600,
      total_vat: 0,
      lines_sum_status: "ok",
      lines_sum_excl_vat: 600,
      lines_sum_variance_pct: 0,
      extraction_confidence: 0.99,
      supplier: null,
      legal_entity: null,
    },
    suggestions: [],
    ...over,
  } as ReviewLineRow;
}

const suggestion = {
  raw_material_id: "rm1",
  confidence: 0.7,
  match_reason: "navnelikhet",
  rank: 1,
  raw_material: null,
};

describe("primaryActionFor", () => {
  it("løser varenummerkonflikt først", () => {
    const a = primaryActionFor(line({ review_reason: "sku_collision,price_variance" }));
    expect(a.kind).toBe("conflict");
    expect(a.label).toBe("Løs konflikt");
  });

  it("prioriterer ukjent pakningsstørrelse foran prisavvik", () => {
    const a = primaryActionFor(line({ review_reason: "unknown_package_size,price_variance" }));
    expect(a.kind).toBe("confirm_link");
    expect(a.label).toBe("Bekreft vare og pakning");
  });

  it("prioriterer uavklart tekstuttrekk foran forslagsgjennomgang", () => {
    const a = primaryActionFor(line({ review_reason: "extraction_unresolved", suggestions: [suggestion] }));
    expect(a.kind).toBe("confirm_link");
  });

  it("behandler usikker kostpris som datafeil, ikke prisavvik", () => {
    const a = primaryActionFor(line({ review_reason: "uncertain_cost" }));
    expect(a.kind).toBe("confirm_link");
  });

  it("kaller regelbaserte forslag «Kontroller forslag», ikke AI-forslag", () => {
    const a = primaryActionFor(line({ review_reason: "unmatched", suggestions: [suggestion] }));
    expect(a.kind).toBe("review_suggestion");
    expect(a.label).toBe("Kontroller forslag");
    expect(a.label).not.toContain("AI");
  });

  it("regner automatisk kobling med lav tillit som uverifisert", () => {
    const a = primaryActionFor(
      line({ review_reason: "low_confidence", raw_material_id: "rm1", match_confidence: "auto_low" }),
    );
    expect(a.kind).toBe("review_suggestion");
    expect(a.hint).toContain("lav tillit");
  });

  it("viser prisavvik først når koblingen faktisk er bekreftet", () => {
    const a = primaryActionFor(
      line({ review_reason: "price_variance", raw_material_id: "rm1", match_confidence: "manual" }),
    );
    expect(a.kind).toBe("variance");
  });

  it("håndterer feil i prisgrunnlaget som en prisårsak", () => {
    const a = primaryActionFor(
      line({ review_reason: "price_reference_error", raw_material_id: "rm1", match_confidence: "manual" }),
    );
    expect(a.kind).toBe("variance");
  });

  it("tilbyr startpris bare når serveren har sagt at linjen kvalifiserer", () => {
    const l = line({ review_reason: null, raw_material_id: "rm1", match_confidence: "manual" });
    expect(primaryActionFor(l).kind).toBe("confirm_link");
    expect(primaryActionFor(l, new Set(["l1"])).kind).toBe("start_price");
  });

  it("ber om ny beregning før alt annet når linjen nettopp er endret", () => {
    const a = primaryActionFor(line({ review_reason: "recalculation_pending,price_variance" }));
    expect(a.kind).toBe("confirm_link");
    expect(a.label).toBe("Kontroller linjen");
  });
});
