// EHF-test: sammenligner strukturerte linjer (EHF/ordrelinjer) med linjene lest fra PDF. Ren logikk.
import { round2, type StructuredDoc, type StructuredLine } from "./structured";

export interface PdfLine {
  id: string;
  lineNumber: number | null;
  sku: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  discount: number | null;
  lineTotal: number | null;
  vatRate: number | null;
  lineKind: string | null;
  packageSize: number | null;
  packageUnit: string | null;
}

export type FieldKey = "sku" | "quantity" | "unit" | "price" | "discount" | "sum" | "vat";
export type FieldState = "lik" | "ulik" | "mangler_pdf" | "mangler_ehf" | "begge_mangler";
export type MatchedBy = "varenummer" | "sum" | "rekkefolge";

export interface PairRow {
  ehf: StructuredLine | null;
  pdf: PdfLine | null;
  matchedBy: MatchedBy | null;
  fields: Record<FieldKey, FieldState>;
}

export const SHARE_FIELDS = ["sku", "quantity", "price", "sum"] as const;
export type ShareField = (typeof SHARE_FIELDS)[number];

export interface InvoiceTotals { totalAmount: number | null; totalVat: number | null; isCredit: boolean }

export interface InvoiceComparison {
  pairs: PairRow[];
  ehfCount: number;
  pdfCount: number;
  /** Like felt blant linjene i det strukturerte dokumentet (nevner = antall strukturerte linjer). */
  equal: Record<ShareField, number>;
  ehfLinesSum: number;
  pdfLinesSum: number;
  /** Linjesum ± dokumentrabatt/-tillegg mot dokumentets egen sum eks. mva. null = dokumentet har ingen sum. */
  matchesOwnTotal: boolean | null;
  /** Mot fakturasummen i NBhub (eks. mva når mva er kjent, ellers inkl. mot dokumentets inkl.-sum). */
  matchesInvoice: boolean | null;
  invoiceExclVat: number | null;
  extraFields: string[];
}

export function normSku(v: string | null): string | null {
  if (!v) return null;
  const s = v.toUpperCase().replace(/[\s.\-/_]/g, "").replace(/^0+(?=\d)/, "");
  return s || null;
}

const UNIT_MAP: Record<string, string> = {
  EA: "stk", C62: "stk", H87: "stk", NAR: "stk", NMP: "stk", PCE: "stk", STK: "stk", ST: "stk", STYKK: "stk",
  KGM: "kg", KG: "kg", GRM: "g", G: "g", LTR: "l", L: "l", LITER: "l", LTRS: "l", MLT: "ml", ML: "ml",
  MTR: "m", M: "m", PK: "pk", PA: "pk", PAK: "pk", PAKKE: "pk", PAKN: "pk", PKN: "pk",
  CT: "kartong", CS: "kartong", KRT: "kartong", KART: "kartong", KARTONG: "kartong", KOLLI: "kolli", COL: "kolli",
  BX: "eske", ESK: "eske", ESKE: "eske", BG: "pose", POS: "pose", POSE: "pose", SAK: "sekk", SEKK: "sekk", SA: "sekk",
  PR: "par", DZN: "dusin", SET: "sett", BO: "flaske", FL: "flaske", FLASKE: "flaske", BKT: "bøtte", SPANN: "spann",
};
export function normUnit(v: string | null): string | null {
  if (!v) return null;
  const k = v.trim().toUpperCase().replace(/\.$/, "");
  return UNIT_MAP[k] ?? (k ? k.toLowerCase() : null);
}

const close = (a: number, b: number, abs: number, rel = 0) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
const vatPct = (v: number | null) => (v == null ? null : Math.abs(v) <= 1 && v !== 0 ? v * 100 : v);

function state<T>(e: T | null, p: T | null, eq: (a: T, b: T) => boolean): FieldState {
  if (e == null && p == null) return "begge_mangler";
  if (e == null) return "mangler_ehf";
  if (p == null) return "mangler_pdf";
  return eq(e, p) ? "lik" : "ulik";
}

export function compareFields(e: StructuredLine | null, p: PdfLine | null): Record<FieldKey, FieldState> {
  const sku = state(normSku(e?.sellerSku ?? null), normSku(p?.sku ?? null), (a, b) => a === b);
  const quantity = state(e?.quantity ?? null, p?.quantity ?? null, (a, b) => close(Math.abs(a), Math.abs(b), 0.0005, 0.0005));
  const unit = state(normUnit(e?.unitCode ?? null), normUnit(p?.unit ?? null), (a, b) => a === b);
  const price = state(e?.unitPrice ?? null, p?.unitPrice ?? null, (a, b) =>
    close(Math.abs(a), Math.abs(b), 0.01, 0.001) || (e?.grossUnitPrice != null && close(Math.abs(e.grossUnitPrice), Math.abs(b), 0.01, 0.001)));
  const ed = e ? (e.discount ?? 0) : null;
  const pd = p ? (p.discount ?? 0) : null;
  const discount = state(ed, pd, (a, b) => close(Math.abs(a), Math.abs(b), 0.02));
  const sum = state(e?.lineTotal ?? null, p?.lineTotal ?? null, (a, b) => close(Math.abs(a), Math.abs(b), 0.02));
  const vat = state(vatPct(e?.vatPercent ?? null), vatPct(p?.vatRate ?? null), (a, b) => close(a, b, 0.01));
  return { sku, quantity, unit, price, discount, sum, vat };
}

/** Parer linjer: varenummer først, så lik sum, så resten i rekkefølge (merket som «rekkefølge»). */
export function pairLines(ehf: StructuredLine[], pdf: PdfLine[]): PairRow[] {
  const used = new Set<string>();
  const pairOf = new Map<number, { p: PdfLine; by: MatchedBy }>();
  const sumClose = (e: StructuredLine, p: PdfLine) => e.lineTotal != null && p.lineTotal != null && close(Math.abs(e.lineTotal), Math.abs(p.lineTotal), 0.02);
  for (const e of ehf) {
    const k = normSku(e.sellerSku);
    if (!k) continue;
    const cands = pdf.filter((p) => !used.has(p.id) && normSku(p.sku) === k);
    const p = cands.find((c) => sumClose(e, c)) ?? cands[0];
    if (p) { used.add(p.id); pairOf.set(e.index, { p, by: "varenummer" }); }
  }
  for (const e of ehf) {
    if (pairOf.has(e.index)) continue;
    const p = pdf.find((c) => !used.has(c.id) && sumClose(e, c));
    if (p) { used.add(p.id); pairOf.set(e.index, { p, by: "sum" }); }
  }
  const restE = ehf.filter((e) => !pairOf.has(e.index));
  const restP = pdf.filter((p) => !used.has(p.id));
  restE.forEach((e, i) => { const p = restP[i]; if (p) { used.add(p.id); pairOf.set(e.index, { p, by: "rekkefolge" }); } });
  const rows: PairRow[] = ehf.map((e) => {
    const m = pairOf.get(e.index) ?? null;
    return { ehf: e, pdf: m?.p ?? null, matchedBy: m?.by ?? null, fields: compareFields(e, m?.p ?? null) };
  });
  for (const p of pdf) if (!used.has(p.id)) rows.push({ ehf: null, pdf: p, matchedBy: null, fields: compareFields(null, p) });
  return rows;
}

export function invoiceExclVat(t: InvoiceTotals): number | null {
  if (t.totalAmount == null || t.totalVat == null) return null;
  const vat = t.isCredit ? Math.sign(t.totalAmount) * Math.abs(t.totalVat) : t.totalVat;
  return round2(t.totalAmount - vat);
}

export function compareInvoice(doc: StructuredDoc, pdf: PdfLine[], totals: InvoiceTotals): InvoiceComparison {
  const pairs = pairLines(doc.lines, pdf);
  const equal = { sku: 0, quantity: 0, price: 0, sum: 0 } as Record<ShareField, number>;
  for (const r of pairs) if (r.ehf && r.pdf) for (const f of SHARE_FIELDS) if (r.fields[f] === "lik") equal[f]++;
  const ehfLinesSum = round2(doc.lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0));
  const pdfLinesSum = round2(pdf.reduce((s, l) => s + (l.lineTotal ?? 0), 0));
  const adj = doc.allowances.reduce((s, a) => s + (a.charge ? a.amount : -a.amount), 0);
  const net = round2(ehfLinesSum + adj);
  const own = doc.taxExclusiveTotal ?? doc.lineExtensionTotal;
  const ownTarget = doc.taxExclusiveTotal != null ? net : ehfLinesSum;
  const matchesOwnTotal = own == null ? null : close(Math.abs(ownTarget), Math.abs(own), 0.05);
  const excl = invoiceExclVat(totals);
  let matchesInvoice: boolean | null = null;
  if (excl != null) matchesInvoice = close(Math.abs(net), Math.abs(excl), 0.05);
  else if (totals.totalAmount != null && (doc.taxInclusiveTotal ?? doc.payableTotal) != null)
    matchesInvoice = close(Math.abs(totals.totalAmount), Math.abs((doc.taxInclusiveTotal ?? doc.payableTotal)!), 0.05);
  return { pairs, ehfCount: doc.lines.length, pdfCount: pdf.length, equal, ehfLinesSum, pdfLinesSum, matchesOwnTotal, matchesInvoice, invoiceExclVat: excl, extraFields: extraFields(doc, pairs, pdf) };
}

/** Felt det strukturerte dokumentet har som PDF-lesingen mangler. */
export function extraFields(doc: StructuredDoc, pairs: PairRow[], pdf: PdfLine[]): string[] {
  const out: string[] = [];
  const L = doc.lines;
  const gtin = L.filter((l) => l.gtin).length;
  if (gtin) out.push(`GTIN/EAN (${gtin} linjer)`);
  const skuMissing = pairs.filter((r) => r.fields.sku === "mangler_pdf").length;
  if (skuMissing) out.push(`Varenummer der PDF mangler (${skuMissing} linjer)`);
  const pack = L.filter((l) => l.packSize != null || l.packQuantity != null).length;
  if (pack) out.push(`Pakningsstørrelse (${pack} linjer)`);
  const unitMissing = pairs.filter((r) => r.fields.unit === "mangler_pdf").length;
  if (unitMissing) out.push(`Enhet der PDF mangler (${unitMissing} linjer)`);
  if (L.some((l) => l.baseQuantity != null && l.baseQuantity !== 1)) out.push("Prisgrunnlag (pris per flere enheter)");
  if (L.some((l) => l.buyerSku)) out.push("Kjøpers varenummer");
  if (L.some((l) => l.vatPercent != null) && pdf.every((p) => p.vatRate == null)) out.push("Mva-sats per linje");
  if (L.some((l) => l.grossUnitPrice != null)) out.push("Bruttopris før rabatt");
  if (doc.allowances.length) out.push(`Rabatt/tillegg på fakturanivå (${doc.allowances.length})`);
  return out;
}
