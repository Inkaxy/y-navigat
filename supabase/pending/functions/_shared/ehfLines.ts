// EHF først (bestilling 19.11.2026): fra tolket EHF/UBL-tre til samme linjeform som PDF-leseren gir,
// slik at `toInvoiceLineRows` (rows.ts) og databasens lesekontroll behandler linjene likt.
// Ren kode uten Deno-/nettleser-API-er; testes i src/test/ehfLines.test.ts.
//
// Treet er resultatet av en XML-tolker som gir objekter (navnerom-prefiks i nøkkel, «@attr», «#text»).
// Regler:
//  - Bare trykte verdier: varenummer (SellersItemIdentification), GTIN, antall + enhetskode, nettopris
//    (PriceAmount / BaseQuantity), rabatt/tillegg fra AllowanceCharge, linjesum og mva-sats.
//  - Rabatt utledes aldri fra differanse antall × pris − sum.
//  - EHF brukes bare når hele dokumentet er komplett: hver linje har sum, summen av linjene stemmer med
//    dokumentets LineExtensionAmount, og dokumentets beløp eks. mva stemmer med Tripletex-hodet.
//    Ellers faller importen tilbake til PDF-lesing (ingen blanding på samme faktura).

type Node = Record<string, unknown>;

const local = (k: string) => k.slice(k.lastIndexOf(":") + 1);
const isNode = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v);

function children(n: unknown, name: string): unknown[] {
  if (!isNode(n)) return [];
  const out: unknown[] = [];
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith("@") || k === "#text" || local(k) !== name) continue;
    if (Array.isArray(v)) out.push(...v); else out.push(v);
  }
  return out;
}
const child = (n: unknown, name: string): unknown => children(n, name)[0];
const path = (n: unknown, ...names: string[]): unknown => names.reduce<unknown>((x, nm) => child(x, nm), n);

function text(n: unknown): string | null {
  if (n == null) return null;
  if (typeof n === "string") return n.trim() || null;
  if (typeof n === "number" || typeof n === "boolean" || typeof n === "bigint") return String(n);
  if (isNode(n)) return text(n["#text"]);
  return null;
}
function attr(n: unknown, a: string): string | null {
  if (!isNode(n)) return null;
  for (const [k, v] of Object.entries(n)) if (k.startsWith("@") && local(k.slice(1)) === a) return text(v);
  return null;
}
function num(n: unknown): number | null {
  const t = text(n);
  if (t == null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(t.replace(/\s/g, ""))) return null; // UBL bruker punktum-desimal
  const v = Number(t.replace(/\s/g, ""));
  return Number.isFinite(v) ? v : null;
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** UN/ECE-enhetskoder (Rec 20/21) → våre kanoniske enheter. Ukjent kode = null (enheten avgjøres ikke). */
export const UNIT_CODES: Readonly<Record<string, string>> = Object.freeze({
  EA: "stk", C62: "stk", H87: "stk", NAR: "stk", PCE: "stk", NPR: "stk",
  KGM: "kg", XKG: "kg", GRM: "g", LTR: "l", MLT: "ml",
  BX: "eske", XBX: "eske", CT: "eske", XCT: "eske", CS: "eske", XCS: "eske",
  PK: "pakke", XPK: "pakke", PA: "pakke", XPA: "pakke",
  BG: "pose", XBG: "pose", SA: "sekk", XSA: "sekk", BO: "flaske", XBO: "flaske",
  PF: "pall", XPF: "pall", PX: "pall", XPX: "pall",
});

const KIND_RULES: Array<[RegExp, string]> = [
  [/\bpant\b|panteavgift/i, "pant"],
  [/frakt|transport|leveringsgebyr|porto/i, "frakt"],
  [/gebyr|ekspedisjon|småordre|fakturaavgift/i, "gebyr"],
];

export interface EhfRawLine {
  description: string | null;
  sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  vat_rate: number | null;
  discount_amount: number | null;
  /** Prisen gjelder én fakturert mengdeenhet (PriceAmount / BaseQuantity). */
  price_basis: "mengdeenhet";
  line_kind: string;
  read_issues: Array<{ code: string; message: string }>;
  number_evidence: Array<Record<string, unknown>>;
  confidence: number;
}

export type EhfParse =
  | { ok: true; credit: boolean; invoiceNumber: string | null; lineExtensionTotal: number | null; taxExclusiveTotal: number | null; lines: EhfRawLine[] }
  | { ok: false; reason: string };

function findRoot(tree: unknown, depth = 0): { node: Node; credit: boolean } | null {
  if (!isNode(tree) || depth > 6) return null;
  for (const [k, v] of Object.entries(tree)) {
    const n = local(k);
    if ((n === "Invoice" || n === "CreditNote") && isNode(v)) return { node: v, credit: n === "CreditNote" };
  }
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith("@") || k === "#text") continue;
    const found = findRoot(Array.isArray(v) ? v[0] : v, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseLine(el: unknown, credit: boolean, docUnknownUnits: Set<string>): EhfRawLine {
  const item = child(el, "Item");
  const qtyEl = child(el, credit ? "CreditedQuantity" : "InvoicedQuantity");
  const price = child(el, "Price");
  const name = text(child(item, "Name"));
  const desc = text(child(item, "Description"));
  const unitCode = attr(qtyEl, "unitCode");
  const unit = unitCode ? UNIT_CODES[unitCode.toUpperCase()] ?? null : null;
  if (unitCode && !unit) docUnknownUnits.add(unitCode);
  const priceAmount = num(child(price, "PriceAmount"));
  const base = num(child(price, "BaseQuantity"));
  const unitPrice = priceAmount == null ? null : r2(priceAmount / (base && base > 0 ? base : 1));
  let allowance = 0, hasA = false;
  for (const ac of children(el, "AllowanceCharge")) {
    const isCharge = text(child(ac, "ChargeIndicator"))?.toLowerCase() === "true";
    const amount = num(child(ac, "Amount"));
    if (!isCharge && amount != null) { allowance += amount; hasA = true; }
  }
  const total = num(child(el, "LineExtensionAmount"));
  const description = [name, desc && desc !== name ? desc : null].filter(Boolean).join(" – ") || null;
  const gtinEl = path(item, "StandardItemIdentification", "ID");
  const gtin = text(gtinEl);
  const issues: Array<{ code: string; message: string }> = [];
  if (unitCode && !unit) issues.push({ code: "ukjent_enhet", message: `Ukjent enhetskode «${unitCode}» i EHF. Kontroller enheten.` });
  const kind = KIND_RULES.find(([re]) => re.test(description ?? ""))?.[1] ?? "vare";
  return {
    description,
    sku: text(path(item, "SellersItemIdentification", "ID")),
    quantity: num(qtyEl),
    unit,
    unit_price: unitPrice,
    total_amount: total,
    vat_rate: num(path(item, "ClassifiedTaxCategory", "Percent")),
    discount_amount: hasA ? r2(allowance) : null,
    price_basis: "mengdeenhet",
    line_kind: kind,
    read_issues: issues,
    number_evidence: [{ kilde: "ehf", enhetskode: unitCode, prisgrunnlag: base, gtin, gtin_skjema: attr(gtinEl, "schemeID") }],
    confidence: 1,
  };
}

/** Tolker et UBL-tre. Kreditnota gir negative beløp, samme fortegnskonvensjon som PDF-leseren. */
export function ehfLinesFromTree(tree: unknown): EhfParse {
  const root = findRoot(tree);
  if (!root) return { ok: false, reason: "Fant verken faktura eller kreditnota i XML-en." };
  const { node, credit } = root;
  const els = children(node, credit ? "CreditNoteLine" : "InvoiceLine");
  if (els.length === 0) return { ok: false, reason: "EHF-dokumentet har ingen linjer." };
  if (els.some((l) => children(l, credit ? "SubCreditNoteLine" : "SubInvoiceLine").length > 0)) {
    return { ok: false, reason: "EHF-dokumentet har underlinjer; leses fra PDF." };
  }
  const unknown = new Set<string>();
  const lines = els.map((l) => parseLine(l, credit, unknown));
  if (credit) for (const l of lines) {
    if (l.total_amount != null) l.total_amount = -Math.abs(l.total_amount);
  }
  const totals = child(node, "LegalMonetaryTotal");
  return {
    ok: true, credit, invoiceNumber: text(child(node, "ID")),
    lineExtensionTotal: num(child(totals, "LineExtensionAmount")),
    taxExclusiveTotal: num(child(totals, "TaxExclusiveAmount")),
    lines,
  };
}

export type EhfDecision = { use: true } | { use: false; reason: string };

/**
 * Avgjør om EHF-linjene kan brukes i stedet for PDF-lesing. Toleranse 1 kr (øreavrunding).
 * expectedExclVat er Tripletex-hodets beløp eks. mva (null = ukjent, da kreves bare intern sumkontroll).
 */
export function decideEhf(p: EhfParse, expectedExclVat: number | null): EhfDecision {
  if (!p.ok) return { use: false, reason: p.reason };
  if (p.lines.some((l) => l.total_amount == null)) return { use: false, reason: "En EHF-linje mangler linjesum." };
  const sum = r2(p.lines.reduce((s, l) => s + Math.abs(l.total_amount ?? 0), 0));
  if (p.lineExtensionTotal != null && Math.abs(sum - Math.abs(p.lineExtensionTotal)) > 1) {
    return { use: false, reason: `Linjesummen i EHF (${sum}) stemmer ikke med dokumentets sum (${p.lineExtensionTotal}).` };
  }
  const docExcl = p.taxExclusiveTotal ?? p.lineExtensionTotal;
  if (expectedExclVat != null && docExcl != null && Math.abs(Math.abs(docExcl) - Math.abs(expectedExclVat)) > 1) {
    return { use: false, reason: `EHF-beløpet eks. mva (${docExcl}) stemmer ikke med Tripletex (${expectedExclVat}).` };
  }
  return { use: true };
}
