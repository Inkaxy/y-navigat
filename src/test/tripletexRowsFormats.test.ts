import { describe, expect, it } from "vitest";
import { toInvoiceLineRows } from "../../supabase/functions/tripletex-import-invoice-lines/rows";
import { sanitizeLines } from "../../supabase/functions/_shared/invoiceExtraction";

const base = { line_kind: "vare", description: "Mel", unit: "stk", unit_price_basis: "per_unit", confidence: 0.9 };

describe("Tripletex-rader bruker samme talltolkning som leseren", () => {
  it("parentes og etterstilt minus gir negative beløp", () => {
    const [r] = toInvoiceLineRows([{ ...base, quantity_raw: "(2)", unit_price_raw: "10,00", total_amount_raw: "20,00-" }], "inv", null);
    expect(r).toMatchObject({ quantity: -2, unit_price: 10, total_amount: -20 });
  });
  it("ugyldig tusengruppe gir ugyldig_tall og null, ikke modelltallet", () => {
    const [r] = toInvoiceLineRows([{ ...base, quantity: 1, unit_price: 123, unit_price_raw: "1 23,00", total_amount: 123 }], "inv", null);
    expect(r.unit_price).toBeNull();
    expect(r.read_issues.map((i) => i.code)).toContain("ugyldig_tall");
  });
  it("leserens ugyldig_tall dupliseres ikke", () => {
    const lines = sanitizeLines([{ ...base, quantity_raw: "1", unit_price_raw: "1 23,00", total_amount_raw: "123,00" }]);
    const [r] = toInvoiceLineRows([{ ...lines[0], unit_price_raw: "1 23,00" }], "inv", null);
    expect(r.read_issues.filter((i) => i.code === "ugyldig_tall")).toHaveLength(1);
  });
  it("Tripletex «10.000» kg × 110,00 = 1 100,00 avgjøres fortsatt av regnestykket", () => {
    const [r] = toInvoiceLineRows([{ ...base, unit: "kg", quantity_raw: "10.000", unit_price_raw: "110,00", total_amount_raw: "1 100,00" }], "inv", "4000");
    expect(r).toMatchObject({ quantity: 10, unit_price: 110, total_amount: 1100, ledger_account: "4000" });
    expect(r.read_issues).toEqual([]);
  });
  it("rabatt og pris beholdes som trykt", () => {
    const [r] = toInvoiceLineRows([{ ...base, quantity_raw: "10", unit_price_raw: "100,00", total_amount_raw: "900,00", discount_pct: 10 }], "inv", null);
    expect(r).toMatchObject({ unit_price: 100, total_amount: 900, discount_amount: 100 });
  });
});
