import { describe, expect, it } from "vitest";
import { decideEhf, ehfLinesFromTree } from "../../supabase/functions/_shared/ehfLines";
import { toInvoiceLineRows } from "../../supabase/functions/tripletex-import-invoice-lines/rows";

// Formen deno.land/x/xml gir: prefiks i nøkler, «@attr», «#text», tall kan komme som number.
const asko = {
  xml: { "@version": "1.0" },
  Invoice: {
    "cbc:ID": "330754268",
    "cac:InvoiceLine": [
      {
        "cbc:ID": 1,
        "cbc:InvoicedQuantity": { "@unitCode": "NAR", "#text": 1 },
        "cbc:LineExtensionAmount": { "@currencyID": "NOK", "#text": 249.87 },
        "cac:AllowanceCharge": { "cbc:ChargeIndicator": false, "cbc:Amount": 13.15 },
        "cac:Item": {
          "cbc:Name": "KRYDDERSMØREMYK 2,5KG UNIL+",
          "cac:SellersItemIdentification": { "cbc:ID": "3229929" },
          "cac:StandardItemIdentification": { "cbc:ID": { "@schemeID": "0160", "#text": "7035620048999" } },
          "cac:ClassifiedTaxCategory": { "cbc:ID": "S", "cbc:Percent": 15 },
        },
        "cac:Price": { "cbc:PriceAmount": 249.87, "cbc:BaseQuantity": 1 },
      },
      {
        "cbc:ID": 2,
        "cbc:InvoicedQuantity": { "@unitCode": "EA", "#text": 5 },
        "cbc:LineExtensionAmount": 1871.5,
        "cac:Item": { "cbc:Name": "Idun Bakemargarin, kartong 2 x 5 kg", "cac:SellersItemIdentification": { "cbc:ID": "18024" }, "cac:ClassifiedTaxCategory": { "cbc:Percent": 15 } },
        "cac:Price": { "cbc:PriceAmount": "374.30" },
      },
    ],
    "cac:LegalMonetaryTotal": { "cbc:LineExtensionAmount": 2121.37, "cbc:TaxExclusiveAmount": 2121.37 },
  },
};

describe("EHF først", () => {
  it("leser varenummer, enhet, nettopris og trykt rabatt", () => {
    const p = ehfLinesFromTree(asko);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.lines[0]).toMatchObject({ sku: "3229929", quantity: 1, unit: "stk", unit_price: 249.87, total_amount: 249.87, discount_amount: 13.15, vat_rate: 15 });
    expect(p.lines[1]).toMatchObject({ sku: "18024", quantity: 5, unit_price: 374.3, discount_amount: null });
  });

  it("pris deles på prisgrunnlaget (BaseQuantity)", () => {
    const t = structuredClone(asko);
    t.Invoice["cac:InvoiceLine"][1]["cac:Price"] = { "cbc:PriceAmount": "3743.00", "cbc:BaseQuantity": 10 } as never;
    const p = ehfLinesFromTree(t);
    expect(p.ok && p.lines[1].unit_price).toBe(374.3);
  });

  it("brukes bare når summene stemmer", () => {
    const p = ehfLinesFromTree(asko);
    expect(decideEhf(p, 2121.37)).toEqual({ use: true });
    expect(decideEhf(p, 2500).use).toBe(false);
    const t = structuredClone(asko);
    t.Invoice["cac:LegalMonetaryTotal"]["cbc:LineExtensionAmount"] = 3000;
    expect(decideEhf(ehfLinesFromTree(t), null).use).toBe(false);
  });

  it("ukjent enhetskode gir ingen gjettet enhet", () => {
    const t = structuredClone(asko);
    t.Invoice["cac:InvoiceLine"][1]["cbc:InvoicedQuantity"] = { "@unitCode": "ZZZ", "#text": 5 } as never;
    const p = ehfLinesFromTree(t);
    expect(p.ok && p.lines[1].unit).toBeNull();
    expect(p.ok && p.lines[1].read_issues[0].code).toBe("ukjent_enhet");
  });

  it("kreditnota gir negative linjesummer", () => {
    const p = ehfLinesFromTree({ CreditNote: { "cac:CreditNoteLine": { "cbc:CreditedQuantity": { "@unitCode": "EA", "#text": 1 }, "cbc:LineExtensionAmount": 50, "cac:Item": { "cbc:Name": "Retur" }, "cac:Price": { "cbc:PriceAmount": 50 } } } });
    expect(p.ok && p.credit && p.lines[0].total_amount).toBe(-50);
  });

  it("ikke-EHF faller tilbake", () => {
    expect(ehfLinesFromTree({ foo: {} }).ok).toBe(false);
  });

  it("går gjennom samme radbygging som PDF-linjer", () => {
    const p = ehfLinesFromTree(asko);
    if (!p.ok) throw new Error();
    const rows = toInvoiceLineRows(p.lines, "inv", "4000");
    expect(rows[0]).toMatchObject({ supplier_sku: "3229929", quantity: 1, unit_price: 249.87, total_amount: 249.87, discount_amount: 13.15, unit_price_basis: "mengdeenhet" });
    expect(rows[1].package_size).toBe(5); // «2 x 5 kg» fra varenavnet, samme regel som PDF
  });
});
