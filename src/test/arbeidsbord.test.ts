import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { clarificationGate } from "@/ravarer/pages/priskontroll/gjore/PriceBlock";
import type { WorkItemsCounts } from "@/ravarer/lib/workRpcTypes";

const counts = { alle: 10, kobling: 2, pakning: 3, pris: 4, kontroll: 1, fakturaer: 5, faktura_mangler_linjer: 1, faktura_sumavvik: 2, faktura_flagget: 0, faktura_klar: 2 } as WorkItemsCounts;


describe("prissperre i varekortet", () => {
  const l = { id: "a", invoice_id: "i", invoice_number: "1", invoice_date: "2026-01-01", invoice_status: null, flagged_at: null, is_credit_note: false, reconciled_mode: null, line_number: 1, supplier_sku: null,
    description: "Mel", quantity: 10, unit: "sekk", unit_price: 100, total_amount: 300, package_size: null, package_unit: null, count_per_package: null, base_quantity: null,
    price_per_base_unit: null, expected_price_per_base_unit: null, price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: null, raw_material_name: null,
    match_confidence: null, requires_review: null, review_reason: null, resolution_note: null };
  it("serverens lesevarsel stenger prisen", () => expect(clarificationGate({ ...l, review_reason: "extraction_unresolved" } as never)?.ok).toBe(false));
  it("eget regnestykke på ufullstendig varekortlinje stenger ikke (mangler prisgrunnlag/rabatt)", () => expect(clarificationGate(l as never)).toBeNull());
  it("regnestykke som går opp stenger ikke", () => expect(clarificationGate({ ...l, total_amount: 1000 } as never)).toBeNull());
});
