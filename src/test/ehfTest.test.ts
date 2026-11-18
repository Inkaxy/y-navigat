// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  containsUbl, documentIdsFrom, sniffContent, stripEmbeddedBinaries, tripletexMessage, xmlRootName,
} from "../../supabase/pending/functions/tripletex-ehf-test/probe";
import { parseUbl } from "@/ravarer/lib/ehfTest/ehfUbl";
import { parseOrderLines } from "@/ravarer/lib/ehfTest/orderLines";
import { compareInvoice, normSku, type PdfLine } from "@/ravarer/lib/ehfTest/compare";
import { classifyFailure, parseProbeResponse, type PickedInvoice, type ProbeLog, type RunOutcome } from "@/ravarer/lib/ehfTest/api";
import { adviceFor, availabilityOf, evaluate, share, summarizeBySupplier } from "@/ravarer/lib/ehfTest/report";

const enc = (s: string) => new TextEncoder().encode(s);

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
 <cbc:ID>9204947561</cbc:ID><cbc:DocumentCurrencyCode>NOK</cbc:DocumentCurrencyCode>
 <cac:AdditionalDocumentReference><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf">JVBERi0xLjQKAAAA</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
 <cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Frakt</cbc:AllowanceChargeReason><cbc:Amount currencyID="NOK">50.00</cbc:Amount></cac:AllowanceCharge>
 <cac:LegalMonetaryTotal>
  <cbc:LineExtensionAmount currencyID="NOK">1076.00</cbc:LineExtensionAmount>
  <cbc:TaxExclusiveAmount currencyID="NOK">1126.00</cbc:TaxExclusiveAmount>
  <cbc:TaxInclusiveAmount currencyID="NOK">1295.00</cbc:TaxInclusiveAmount>
  <cbc:PayableAmount currencyID="NOK">1295.00</cbc:PayableAmount>
 </cac:LegalMonetaryTotal>
 <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="CT">6</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="NOK">1052.00</cbc:LineExtensionAmount>
  <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="NOK">28.00</cbc:Amount></cac:AllowanceCharge>
  <cac:Item><cbc:Name>ISTE CHAI 1L</cbc:Name><cbc:PackQuantity unitCode="EA">6</cbc:PackQuantity>
   <cac:SellersItemIdentification><cbc:ID>97 27</cbc:ID></cac:SellersItemIdentification>
   <cac:StandardItemIdentification><cbc:ID schemeID="0160">7038010000000</cbc:ID></cac:StandardItemIdentification>
   <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item>
  <cac:Price><cbc:PriceAmount currencyID="NOK">180.00</cbc:PriceAmount><cbc:BaseQuantity unitCode="CT">1</cbc:BaseQuantity></cac:Price>
 </cac:InvoiceLine>
 <cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="EA">24</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="NOK">24.00</cbc:LineExtensionAmount>
  <cac:Item><cbc:Name>Pant 1 kr</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>25</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item>
  <cac:Price><cbc:PriceAmount currencyID="NOK">10.00</cbc:PriceAmount><cbc:BaseQuantity unitCode="EA">10</cbc:BaseQuantity></cac:Price>
 </cac:InvoiceLine>
</Invoice>`;

const pdf = (o: Partial<PdfLine>): PdfLine => ({
  id: o.id ?? "p", lineNumber: null, sku: null, description: null, quantity: null, unit: null, unitPrice: null, discount: null,
  lineTotal: null, vatRate: null, lineKind: null, packageSize: null, packageUnit: null, ...o,
});
const invoice = (o: Partial<PickedInvoice> = {}): PickedInvoice => ({
  id: "inv1", supplierId: "s1", supplierName: "ASKO", invoiceNumber: "9204947561", invoiceDate: "2026-11-10",
  totalAmount: 1295, totalVat: 169, isCredit: false, linesSumStatus: "ok",
  pdfLines: [pdf({ id: "a", sku: "9727", quantity: 6, unit: "krt", unitPrice: 180, discount: 28, lineTotal: 1052, vatRate: 15 }),
    pdf({ id: "b", sku: null, quantity: 1, unitPrice: 24, lineTotal: 24 })],
  ...o,
});
const log = (o: Partial<ProbeLog>): ProbeLog => ({ step: "s", path: "/v2/document/1/content", status: 200, contentType: null, bytes: 10, kind: "xml", note: null, tripletexMessage: null, ...o });
const okOutcome = (xml: string | null, probes: ProbeLog[] = [], orderLines: unknown[] | null = null): RunOutcome => ({
  kind: "ok",
  data: { invoiceId: "inv1", supplierInvoiceId: "1", voucherId: "2", probes, supplierInvoice: null, orderLines, incoming: null,
    xml: xml == null ? null : { documentId: "1", source: "bilag.ediDocument", root: "Invoice", ubl: "Invoice", text: xml, removedEmbedded: 0, removedBytes: 0, truncated: false } },
});

describe("EHF-test: gjenkjenning av innhold (testfunksjonen)", () => {
  it("skiller PDF, XML (med BOM), zip, JSON og tomt svar", () => {
    expect(sniffContent(enc("%PDF-1.4"), "application/octet-stream")).toBe("pdf");
    expect(sniffContent(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("\n<?xml?>")]), null)).toBe("xml");
    expect(sniffContent(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]), null)).toBe("zip");
    expect(sniffContent(enc('{"value":{}}'), "application/json")).toBe("json");
    expect(sniffContent(new Uint8Array(), null)).toBe("tom");
  });
  it("finner UBL også inne i en SBDH-konvolutt og leser rotnavnet", () => {
    const sbdh = `<?xml version="1.0"?><sh:StandardBusinessDocument xmlns:sh="x"><Invoice xmlns="y"></Invoice></sh:StandardBusinessDocument>`;
    expect(containsUbl(sbdh)).toBe("Invoice");
    expect(xmlRootName(sbdh)).toBe("StandardBusinessDocument");
    expect(containsUbl("<Order xmlns='z'><InvoiceRef/></Order>")).toBeNull();
    expect(containsUbl("<CreditNote xmlns='z'></CreditNote>")).toBe("CreditNote");
  });
  it("fjerner innebygde vedlegg, men beholder linjene", () => {
    const r = stripEmbeddedBinaries(UBL);
    expect(r.removed).toBe(1);
    expect(r.removedBytes).toBe("JVBERi0xLjQKAAAA".length);
    expect(r.xml).not.toContain("JVBERi0x");
    expect(r.xml).toContain("ISTE CHAI");
  });
  it("viser Tripletex' feiltekst i klartekst", () => {
    expect(tripletexMessage('{"status":403,"message":"You do not have permission","validationMessages":[{"field":"document","message":"Mangler tilgang"}]}'))
      .toBe("You do not have permission · document: Mangler tilgang");
    expect(tripletexMessage("<html> Bad   gateway </html>")).toBe("<html> Bad gateway </html>");
  });
  it("prøver bilagets EHF-dokument først og tar ikke samme dokument to ganger", () => {
    expect(documentIdsFrom({ originalInvoiceDocumentId: 5, voucher: { ediDocument: { id: 7 } } }, { ediDocument: { id: 7 }, attachment: { id: 9 } }))
      .toEqual([{ id: "7", source: "bilag.ediDocument" }, { id: "5", source: "leverandørfaktura.originalInvoiceDocumentId" }, { id: "9", source: "bilag.attachment" }]);
    expect(documentIdsFrom(null, null)).toEqual([]);
  });
});

describe("EHF-test: tolking av UBL", () => {
  it("leser varenummer, GTIN, antall, enhet, pris per prisgrunnlag, rabatt, mva og pakning", () => {
    const r = parseUbl(UBL);
    if (!r.ok) throw new Error(r.error);
    const [l1, l2] = r.doc.lines;
    expect(r.doc.invoiceNumber).toBe("9204947561");
    expect(l1).toMatchObject({ sellerSku: "97 27", gtin: "7038010000000", gtinScheme: "0160", quantity: 6, unitCode: "CT", unitPrice: 180, discount: 28, lineTotal: 1052, vatPercent: 15, packQuantity: 6, kind: "vare" });
    expect(l2).toMatchObject({ unitPrice: 1, baseQuantity: 10, kind: "pant", vatPercent: 25 });
    expect(r.doc.allowances).toEqual([{ charge: true, amount: 50, reason: "Frakt" }]);
    expect(r.doc.taxExclusiveTotal).toBe(1126);
  });
  it("avviser XML som ikke er EHF", () => {
    expect(parseUbl("<Order><ID>1</ID></Order>")).toEqual({ ok: false, error: expect.stringContaining("ikke EHF") });
    expect(parseUbl("<Invoice><ID>").ok).toBe(false);
  });
  it("leser kreditnota med CreditedQuantity", () => {
    const xml = `<CreditNote xmlns="u" xmlns:cbc="b" xmlns:cac="a"><cbc:ID>K1</cbc:ID><cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity unitCode="KGM">2.5</cbc:CreditedQuantity><cbc:LineExtensionAmount>-50</cbc:LineExtensionAmount><cac:Item><cbc:Name>Mel</cbc:Name></cac:Item></cac:CreditNoteLine></CreditNote>`;
    const r = parseUbl(xml);
    if (!r.ok) throw new Error(r.error);
    expect(r.doc.docType).toBe("CreditNote");
    expect(r.doc.lines[0]).toMatchObject({ quantity: 2.5, unitCode: "KGM", lineTotal: -50 });
  });
});

describe("EHF-test: sammenligning mot PDF", () => {
  it("parer på varenummer (mellomrom ignoreres), ellers på sum, og merker felt per linje", () => {
    const r = parseUbl(UBL);
    if (!r.ok) throw new Error(r.error);
    const c = compareInvoice(r.doc, invoice().pdfLines, { totalAmount: 1295, totalVat: 169, isCredit: false });
    expect(normSku("97 27")).toBe("9727");
    expect(c.pairs[0]).toMatchObject({ matchedBy: "varenummer", fields: { sku: "lik", quantity: "lik", unit: "lik", price: "lik", discount: "lik", sum: "lik", vat: "lik" } });
    expect(c.pairs[1]).toMatchObject({ matchedBy: "sum", fields: { sku: "begge_mangler", quantity: "ulik", price: "ulik", sum: "lik", vat: "mangler_pdf" } });
    expect(c.equal).toEqual({ sku: 1, quantity: 1, price: 1, sum: 2 });
    expect(c.ehfLinesSum).toBe(1076);
    expect(c.matchesOwnTotal).toBe(true); // 1076 + 50 frakt = 1126
    expect(c.invoiceExclVat).toBe(1126);
    expect(c.matchesInvoice).toBe(true);
    expect(c.extraFields).toEqual(expect.arrayContaining(["GTIN/EAN (1 linjer)", "Pakningsstørrelse (1 linjer)", "Prisgrunnlag (pris per flere enheter)", "Rabatt/tillegg på fakturanivå (1)"]));
  });
  it("viser linjer som bare finnes i PDF, og sier at summen ikke stemmer når den ikke gjør det", () => {
    const r = parseUbl(UBL);
    if (!r.ok) throw new Error(r.error);
    const extra = [...invoice().pdfLines, pdf({ id: "c", sku: "1", lineTotal: 5 }), pdf({ id: "d", lineTotal: 7 })];
    const c = compareInvoice(r.doc, extra, { totalAmount: 1400, totalVat: 169, isCredit: false });
    expect(c.pairs.filter((p) => !p.ehf).map((p) => p.pdf?.id)).toEqual(["c", "d"]);
    expect(c.matchesInvoice).toBe(false);
  });
});

describe("EHF-test: Tripletex-linjer, svar og vurdering", () => {
  it("teller ikke rene referanser som linjer, men leser linjer med innhold", () => {
    expect(parseOrderLines([{ id: 1, url: "x" }])).toBeNull();
    const d = parseOrderLines([{ id: 1, description: "Mel", count: 2, unitPriceExcludingVatCurrency: 100, discount: 10, amountExcludingVatCurrency: 180, product: { number: "A1", ean: "7000" }, vatType: { percentage: 15 } }]);
    expect(d?.lines[0]).toMatchObject({ sellerSku: "A1", gtin: "7000", quantity: 2, unitPrice: 100, discountPct: 10, discount: 20, lineTotal: 180, vatPercent: 15 });
  });
  it("404 uten vårt svarformat betyr ikke rullet ut; vårt eget avslag vises med melding", () => {
    expect(classifyFailure(404, { code: "NOT_FOUND", message: "Requested function was not found" })).toEqual({ kind: "ikke_utrullet" });
    expect(classifyFailure(403, { ok: false, code: "ingen_tilgang", message: "Bare godkjenner" })).toEqual({ kind: "avvist", status: 403, code: "ingen_tilgang", message: "Bare godkjenner" });
    expect(classifyFailure(null, null).kind).toBe("ukjent");
  });
  it("leser svaret strengt", () => {
    expect(parseProbeResponse({ ok: true, invoice_id: "x" })).toBeNull();
    expect(parseProbeResponse({ ok: true, invoice_id: "x", probes: [{ step: "a" }] })).toBeNull();
    expect(parseProbeResponse({ ok: true, invoice_id: "x", probes: [], xml: null })?.probes).toEqual([]);
  });
  it("vurderer tilgjengelighet: EHF, bare PDF, feilkode", () => {
    expect(availabilityOf(okOutcome(UBL)).state).toBe("ja");
    expect(availabilityOf(okOutcome(null, [log({ kind: "pdf" })])).label).toBe("Nei – bare PDF");
    expect(availabilityOf(okOutcome(null, [log({ status: 403, kind: "json" })])).label).toBe("Feil 403");
    expect(availabilityOf(okOutcome(null, [])).label).toBe("Nei – ingen dokument i Tripletex");
    expect(availabilityOf({ kind: "ikke_utrullet" }).label).toBe("Ikke rullet ut");
  });
  it("gir råd ved manglende rettighet, men ikke for betaendepunkt som ikke finnes", () => {
    expect(adviceFor(log({ status: 403 }))).toContain("dokumentarkiv");
    expect(adviceFor(log({ status: 404, path: "/v2/incomingInvoice/2?fields=*" }))).toBeNull();
    expect(adviceFor(log({ status: 200 }))).toBeNull();
  });
  it("sammendrag per leverandør: andel av strukturerte linjer, ukjent er ikke 0", () => {
    const withEhf = evaluate(invoice(), okOutcome(UBL));
    const without = evaluate(invoice({ id: "inv2", supplierId: "s2", supplierName: "TINE" }), okOutcome(null, [log({ kind: "pdf" })]));
    const rows = summarizeBySupplier([without, withEhf]);
    expect(rows.map((r) => r.supplierName)).toEqual(["ASKO", "TINE"]);
    expect(rows[0]).toMatchObject({ ehfLabel: "Ja (1 av 1)", structuredLines: 2, pdfLines: 2, sumOk: 1, sumKnown: 1, equal: { sku: 1, quantity: 1, price: 1, sum: 2 } });
    expect(share(rows[0].equal.sum, rows[0].structuredLines)).toBe(100);
    expect(rows[1]).toMatchObject({ ehfLabel: "Nei – bare PDF", structuredLines: 0 });
    expect(share(0, 0)).toBeNull();
  });
});
