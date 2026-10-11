import type { RunRowInput } from "@/fakturaer/lib/reread";

const LE = "751709bc-04b3-4449-867d-b97faa9ab373";
const line = (id: string, n: number, o: Record<string, unknown>) => ({
  id, line_number: n, supplier_sku: null, description: null, quantity: null, unit: null, unit_price: null, total_amount: null,
  package_size: null, package_unit: null, count_per_package: null, line_kind: "vare", unit_price_basis: null, discount_amount: null,
  extraction_issues: [], match_confidence: null, raw_material_id: null, ...o,
});
const vals = (o: Record<string, unknown>) => ({
  supplier_sku: null, description: null, quantity: null, unit: null, unit_price: null, total_amount: null, package_size: null,
  package_unit: null, count_per_package: null, line_kind: "vare", unit_price_basis: null, discount_amount: null, ...o,
});

/** Faste data: foreslått par, tidligere rettet linje, manuelt koblet linje, manglende linje, varsler. */
export function rereadFixtureRow(status: "ready" | "reading" | "failed"): RunRowInput {
  return {
    id: "00000000-0000-4000-8000-000000000001", invoice_id: "inv-1", legal_entity_id: LE, created_by: "u1", status,
    error_code: status === "failed" ? "leser_ingen_linjer" : null, created_at: "2026-10-11T14:05:00Z", expires_at: "2026-10-12T14:05:00Z",
    document_path: `${LE}/2026/pals-526301.pdf`,
    snapshot: {
      invoice: { invoice_number: "526301", invoice_date: "2026-09-28", total_amount: 32230.93, total_vat: 6446.19, currency: "NOK", is_credit_note: false,
        extraction_issues: [{ code: "sum_avvik", message: "Lest linjesum 343 103,50 kr avviker fra netto 25 784,74 kr." }] },
      lines: [
        line("l1", 1, { supplier_sku: "10021", description: "Hvetemel Regal 25 kg", quantity: 10000, unit: "sekk", unit_price: 312.5, total_amount: 312500 }),
        line("l2", 2, { supplier_sku: "20410", description: "Smør usaltet 10 kg", quantity: 3, unit: "kartong", unit_price: 890, total_amount: 2670, extraction_issues: [{ code: "tvetydig_tall", message: "Tvetydig tall i mengde («3.000»)." }] }),
        line("l3", 3, { supplier_sku: "30110", description: "Sukker 25 kg", quantity: 4, unit: "sekk", unit_price: 455, total_amount: 1820, match_confidence: "manual", raw_material_id: "rm-1" }),
      ],
      corrections: [{ id: "c1", invoice_line_id: "l2" }],
    },
    proposal: {
      header: { read: { invoice_number: "526301", invoice_date: "2026-09-28", total_amount: 32230.93, total_vat: 6446.19, currency: "NOK" } },
      invoice_issues: [{ code: "reread_warning", message: "1 linje(r) har regne-, enhets- eller fortegnsavvik og må kontrolleres" }],
      candidates: [
        { candidate_id: "line-0", values: vals({ supplier_sku: "10021", description: "Hvetemel Regal 25 kg", quantity: 10, unit: "sekk", unit_price: 312.5, total_amount: 3125, unit_price_basis: "mengdeenhet" }), issues: [],
          evidence: { confidence: 1, number_evidence: [{ field: "quantity", raw: "10.000" }], ean: "7038010000010", vat_rate: 15, discount_pct: null } },
        { candidate_id: "line-1", values: vals({ supplier_sku: "20410", description: "Smør usaltet 10 kg", quantity: 3, unit: "kartong", unit_price: 890, total_amount: 2670 }), issues: [], evidence: { confidence: 0.92, number_evidence: [] } },
        { candidate_id: "line-2", values: vals({ supplier_sku: "30111", description: "Sukker fin 25 kg", quantity: 4, unit: "sekk", unit_price: 455, total_amount: 1820 }), issues: [], evidence: { confidence: null, number_evidence: [] } },
        { candidate_id: "line-3", values: vals({ supplier_sku: "40990", description: "Frakt", quantity: 1, unit: "stk", unit_price: 450, total_amount: 450, line_kind: "frakt" }),
          issues: [{ code: "linjesum_avvik", message: "Linjesum stemmer ikke med mengde × pris." }], evidence: { confidence: 0.6, number_evidence: [] } },
      ],
    },
    extractor: { extraction_method: "ai", confidence: 0.81, warning_count: 1 },
    result: null, applied_operations: null, apply_reason: null,
  };
}
