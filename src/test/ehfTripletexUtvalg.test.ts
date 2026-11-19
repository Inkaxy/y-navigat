// Gjennomgang 19.11.2026: de 11 EHF-fakturaene fra EHF-testen mot Tripletex (119 linjer, ASKO, Idun, TINE, Drammen Papir m.fl.)
// kjøres gjennom samme vei som importen (EHF-tolkning → radbygging → lesekontroll). Treet bygges slik XML-tolkeren gir det
// med EHF_XML_OPTIONS: alle verdier er tekst.
import { describe, expect, it } from "vitest";
import { decideEhf, EHF_XML_OPTIONS, ehfLinesFromTree } from "../../supabase/functions/_shared/ehfLines";
import { toInvoiceLineRows } from "../../supabase/functions/tripletex-import-invoice-lines/rows";
import { lineReadIssues } from "@/fakturaer/lib/invoiceReadCheck";
import cases from "./fixtures/ehf-tripletex-2026-11-19.json";

interface FxLine { sku: string; name: string; qty: number; unitCode: string; priceAmount: number; baseQuantity?: number; unitPrice: number; discount?: number; charge?: number; total: number; vat: number; gtin?: string }
interface FxCase { leverandor: string; faktura: string; eksMva: number; lineExtensionTotal: number; taxExclusiveTotal: number; lines: FxLine[] }

const s = (v: number) => String(v);
function tree(c: FxCase) {
  return {
    Invoice: {
      "cbc:ID": c.faktura,
      "cac:LegalMonetaryTotal": { "cbc:LineExtensionAmount": { "@currencyID": "NOK", "#text": s(c.lineExtensionTotal) }, "cbc:TaxExclusiveAmount": s(c.taxExclusiveTotal) },
      "cac:InvoiceLine": c.lines.map((l) => ({
        "cbc:InvoicedQuantity": { "@unitCode": l.unitCode, "#text": s(l.qty) },
        "cbc:LineExtensionAmount": { "@currencyID": "NOK", "#text": s(l.total) },
        "cac:AllowanceCharge": [
          ...(l.discount != null ? [{ "cbc:ChargeIndicator": "false", "cbc:Amount": s(l.discount) }] : []),
          ...(l.charge != null ? [{ "cbc:ChargeIndicator": "true", "cbc:Amount": s(l.charge) }] : []),
        ],
        "cac:Item": {
          "cbc:Name": l.name,
          "cac:SellersItemIdentification": { "cbc:ID": l.sku },
          ...(l.gtin ? { "cac:StandardItemIdentification": { "cbc:ID": { "@schemeID": "0160", "#text": l.gtin } } } : {}),
          "cac:ClassifiedTaxCategory": { "cbc:Percent": s(l.vat) },
        },
        "cac:Price": { "cbc:PriceAmount": s(l.priceAmount), ...(l.baseQuantity != null ? { "cbc:BaseQuantity": s(l.baseQuantity) } : {}) },
      })),
    },
  };
}

const all = cases as FxCase[];

describe("EHF fra Tripletex (11 ekte fakturaer)", () => {
  it("tolkeren kjøres med alle verdier som tekst", () => {
    expect(EHF_XML_OPTIONS).toEqual({ reviveNumbers: false, reviveBooleans: false });
  });

  it.each(all.map((c) => [c.leverandor, c] as const))("%s: varenummer, mengde, enhetspris og sum lander som i EHF", (_n, c) => {
    const p = ehfLinesFromTree(tree(c));
    expect(decideEhf(p, c.eksMva)).toEqual({ use: true });
    if (!p.ok) return;
    const rows = toInvoiceLineRows(p.lines, "inv", null);
    expect(rows).toHaveLength(c.lines.length);
    rows.forEach((r, i) => {
      const l = c.lines[i];
      expect(r.supplier_sku).toBe(l.sku);
      expect(r.quantity).toBe(l.qty);
      expect(r.unit_price).toBeCloseTo(l.unitPrice, 5);
      expect(r.total_amount).toBe(l.total);
    });
  });

  it("varenummer med ledende null beholdes", () => {
    const c = structuredClone(all[0]);
    c.lines[0].sku = "0023";
    const p = ehfLinesFromTree(tree(c));
    expect(p.ok && p.lines[0].sku).toBe("0023");
  });

  it("ASKO: pris per pakke (BaseQuantity 1/12) og enhetskode NMP blir pakke", () => {
    const c = all.find((x) => x.leverandor.startsWith("ASKO"))!;
    const p = ehfLinesFromTree(tree(c));
    if (!p.ok) throw new Error();
    const kokos = p.lines.find((l) => l.sku === "3386067")!;
    expect(kokos.unit).toBe("pakke");
    expect(kokos.unit_price).toBeCloseTo(104.52, 4);
    expect(kokos.read_issues).toEqual([]);
  });

  it("enhetspris beholder EHF-ens desimaler (Bama 48,015)", () => {
    const c = all.find((x) => x.leverandor.startsWith("Bama"))!;
    const p = ehfLinesFromTree(tree(c));
    expect(p.ok && p.lines[0].unit_price).toBe(48.015);
  });

  it("trykt tillegg skjules ikke i rabatten, men gir lesevarsel med beløpet", () => {
    const c = all.find((x) => x.leverandor.startsWith("Drammen"))!;
    const p = ehfLinesFromTree(tree(c));
    if (!p.ok) throw new Error();
    const l = p.lines[0]; // Kransekake: 2 × 450,81 − 207,37 + 20,64 = 714,89
    expect(l.discount_amount).toBe(207.37);
    expect(l.read_issues.map((x) => x.code)).toContain("tillegg");
    expect(l.read_issues.find((x) => x.code === "tillegg")?.message).toContain("20,64 kr");
  });

  it("uten tillegg og med kjent enhet: ingen linjer får lesevarsel fra databasens regnestykke", () => {
    let checked = 0;
    for (const c of all) {
      const p = ehfLinesFromTree(tree(c));
      if (!p.ok) throw new Error(c.leverandor);
      const rows = toInvoiceLineRows(p.lines, "inv", null);
      rows.forEach((r, i) => {
        if (c.lines[i].charge != null) return;
        checked++;
        expect({ lev: c.leverandor, linje: i + 1, varsler: lineReadIssues({ ...r, is_credit: false }) }).toEqual({ lev: c.leverandor, linje: i + 1, varsler: [] });
      });
    }
    expect(checked).toBe(100);
  });
});
