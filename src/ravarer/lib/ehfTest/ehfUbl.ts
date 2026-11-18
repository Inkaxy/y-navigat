// EHF-test: tolker UBL 2.1 / Peppol BIS 3.0 (faktura og kreditnota, også inne i SBDH-konvolutt).
// Bruker nettleserens DOMParser (navnerom-uavhengig, ser bare på lokale navn). Skriver ingenting.
import { classifyLine, emptyLine, round2, type DocAllowance, type StructuredDoc, type StructuredLine } from "./structured";

const kids = (el: Element | null, name: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.localName === name) : [];
const kid = (el: Element | null, name: string): Element | null => kids(el, name)[0] ?? null;
const path = (el: Element | null, ...names: string[]): Element | null => names.reduce<Element | null>((e, n) => kid(e, n), el);
const text = (el: Element | null): string | null => { const t = el?.textContent?.trim(); return t ? t : null; };
const num = (el: Element | null): number | null => {
  const t = text(el);
  if (t == null) return null;
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function findRoot(doc: Document): Element | null {
  const r = doc.documentElement;
  if (!r) return null;
  if (r.localName === "Invoice" || r.localName === "CreditNote") return r;
  const all = r.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const n = all[i].localName;
    if (n === "Invoice" || n === "CreditNote") return all[i];
  }
  return null;
}

function parseLine(el: Element, index: number, credit: boolean): StructuredLine {
  const line = emptyLine(index);
  const item = kid(el, "Item");
  const qtyEl = kid(el, credit ? "CreditedQuantity" : "InvoicedQuantity");
  const price = kid(el, "Price");
  line.lineId = text(kid(el, "ID"));
  line.quantity = num(qtyEl);
  line.unitCode = qtyEl?.getAttribute("unitCode") ?? null;
  line.lineTotal = num(kid(el, "LineExtensionAmount"));
  line.name = text(kid(item, "Name"));
  line.description = text(kid(item, "Description"));
  line.sellerSku = text(path(item, "SellersItemIdentification", "ID"));
  line.buyerSku = text(path(item, "BuyersItemIdentification", "ID"));
  const std = path(item, "StandardItemIdentification", "ID");
  line.gtin = text(std);
  line.gtinScheme = std?.getAttribute("schemeID") ?? null;
  line.packQuantity = num(kid(item, "PackQuantity"));
  line.packSize = num(kid(item, "PackSizeNumeric"));
  const tax = kid(item, "ClassifiedTaxCategory");
  line.vatCategory = text(kid(tax, "ID"));
  line.vatPercent = num(kid(tax, "Percent"));
  const priceAmount = num(kid(price, "PriceAmount"));
  const base = num(kid(price, "BaseQuantity"));
  line.baseQuantity = base;
  const divisor = base && base > 0 ? base : 1;
  line.unitPrice = priceAmount == null ? null : priceAmount / divisor;
  const gross = num(path(price, "AllowanceCharge", "BaseAmount"));
  line.grossUnitPrice = gross == null ? null : gross / divisor;
  let allowance = 0, charge = 0, hasA = false, hasC = false;
  let pct: number | null = null;
  for (const ac of kids(el, "AllowanceCharge")) {
    const isCharge = text(kid(ac, "ChargeIndicator"))?.toLowerCase() === "true";
    const amount = num(kid(ac, "Amount")) ?? 0;
    if (isCharge) { charge += amount; hasC = true; } else { allowance += amount; hasA = true; pct ??= num(kid(ac, "MultiplierFactorNumeric")); }
  }
  line.discount = hasA ? round2(allowance) : null;
  line.discountPct = pct;
  line.charge = hasC ? round2(charge) : null;
  line.kind = classifyLine(`${line.name ?? ""} ${line.description ?? ""}`, line.lineTotal);
  return line;
}

export type UblResult = { ok: true; doc: StructuredDoc } | { ok: false; error: string };

export function parseUbl(xml: string, parser: DOMParser = new DOMParser()): UblResult {
  let dom: Document;
  try { dom = parser.parseFromString(xml, "application/xml"); } catch { return { ok: false, error: "XML-en kunne ikke leses." }; }
  if (dom.getElementsByTagName("parsererror").length > 0) return { ok: false, error: "XML-en er ikke gyldig." };
  const root = findRoot(dom);
  if (!root) return { ok: false, error: "Fant verken faktura eller kreditnota i XML-en (ikke EHF/UBL)." };
  const credit = root.localName === "CreditNote";
  const total = kid(root, "LegalMonetaryTotal");
  const allowances: DocAllowance[] = kids(root, "AllowanceCharge").map((ac) => ({
    charge: text(kid(ac, "ChargeIndicator"))?.toLowerCase() === "true",
    amount: num(kid(ac, "Amount")) ?? 0,
    reason: text(kid(ac, "AllowanceChargeReason")) ?? text(kid(ac, "AllowanceChargeReasonCode")),
  }));
  const lineEls = kids(root, credit ? "CreditNoteLine" : "InvoiceLine");
  const notes: string[] = [];
  const sub = lineEls.reduce((n, l) => n + kids(l, credit ? "SubCreditNoteLine" : "SubInvoiceLine").length, 0);
  if (sub > 0) notes.push(`${sub} underlinjer er ikke tatt med (bare hovedlinjene sammenlignes).`);
  return {
    ok: true,
    doc: {
      source: "ehf",
      docType: credit ? "CreditNote" : "Invoice",
      invoiceNumber: text(kid(root, "ID")),
      currency: text(kid(root, "DocumentCurrencyCode")),
      lineExtensionTotal: num(kid(total, "LineExtensionAmount")),
      taxExclusiveTotal: num(kid(total, "TaxExclusiveAmount")),
      taxInclusiveTotal: num(kid(total, "TaxInclusiveAmount")),
      payableTotal: num(kid(total, "PayableAmount")),
      allowances,
      lines: lineEls.map((l, i) => parseLine(l, i, credit)),
      notes,
    },
  };
}
