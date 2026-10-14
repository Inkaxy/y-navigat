import { describe, expect, it } from "vitest";
import { lineDiscountFrom, parsePrintedAmount, sanitizeLines } from "../../supabase/functions/_shared/invoiceExtraction.ts";
import { toInvoiceLineRows } from "../../supabase/functions/tripletex-import-invoice-lines/rows.ts";

const florapan = { line_kind: "vare", sku: "3021", description: "Florapan L62", quantity: 10, quantity_raw: "10", unit: "sekk",
  unit_price: 977.74, unit_price_raw: "977,74", total_amount: 6697.5, total_amount_raw: "6 697,50", package_size: 100, package_unit: "g" };

describe("trykt linjerabatt", () => {
  it("tolker trykte formater", () => {
    expect(parsePrintedAmount("-3 079,90")).toBe(-3079.9);
    expect(parsePrintedAmount("(3079,90)")).toBe(-3079.9);
    expect(parsePrintedAmount("3079,90-")).toBe(-3079.9);
    expect(parsePrintedAmount("3,079.9x")).toBeNull();
  });
  it("Florapan: trykt -3079,90 gir positiv rabatt og ingen lesefeil", () => {
    const [l] = sanitizeLines([{ ...florapan, discount_amount_raw: "-3 079,90", discount_amount: 3079.9 }]);
    expect(l.discount_amount).toBe(3079.9);
    expect(l.read_issues.map((i) => i.code)).not.toContain("regnestykke");
    expect(l.read_issues).toEqual([]);
  });
  it("uten trykt rabatt gjettes den aldri fra differansen", () => {
    const [l] = sanitizeLines([florapan]);
    expect(l.discount_amount).toBeNull();
    expect(l.read_issues.length).toBeGreaterThan(0);
  });
  it("modelltall som ikke matcher råteksten forkastes; påslag er ikke rabatt", () => {
    expect(lineDiscountFrom({ discount_amount_raw: "-3 079,90", discount_amount: 3000 }, null, 6697.5)).toBeNull();
    expect(lineDiscountFrom({ discount_amount_raw: "250,00", discount_kind: "paslag" }, null, 100)).toBeNull();
    expect(lineDiscountFrom({ discount_amount_raw: "250,00", discount_kind: "rabatt" }, null, 100)).toBe(250);
  });
  it("Tripletex-importen lagrer samme trykte rabatt", () => {
    const rows = toInvoiceLineRows([{ ...florapan, discount_amount_raw: "-3 079,90", discount_amount: 3079.9 }], "inv", null);
    expect(rows[0].discount_amount).toBe(3079.9);
  });
});

import { supersededReasonText } from "@/ravarer/lib/priceReference";
describe("prishistorikk: ny versjon ved nytt grunnlag", () => {
  it("forklarer at gammel observasjon beholder sin pris og enhet", () => {
    expect(supersededReasonText("nytt_prisgrunnlag")).toMatch(/ny versjon.*beholder sin opprinnelige pris og enhet/);
  });
});
