// EHF-test: felles form for strukturerte linjer (EHF-XML, Tripletex-ordrelinjer, inngående faktura).
export type LineKind = "vare" | "pant" | "avgift" | "gebyr" | "frakt" | "rabatt";
export type StructuredSource = "ehf" | "ordrelinjer" | "inngaaende";

export interface StructuredLine {
  index: number;
  lineId: string | null;
  sellerSku: string | null;
  buyerSku: string | null;
  gtin: string | null;
  gtinScheme: string | null;
  name: string | null;
  description: string | null;
  quantity: number | null;
  unitCode: string | null;
  /** Netto enhetspris (pris / prisgrunnlag). */
  unitPrice: number | null;
  /** Brutto enhetspris før prisrabatt, når dokumentet oppgir den. */
  grossUnitPrice: number | null;
  baseQuantity: number | null;
  /** Rabatt på linjen i kroner (sum av linjerabatter). */
  discount: number | null;
  discountPct: number | null;
  charge: number | null;
  lineTotal: number | null;
  vatPercent: number | null;
  vatCategory: string | null;
  packSize: number | null;
  packQuantity: number | null;
  kind: LineKind;
}

export interface DocAllowance { charge: boolean; amount: number; reason: string | null }

export interface StructuredDoc {
  source: StructuredSource;
  docType: "Invoice" | "CreditNote" | null;
  invoiceNumber: string | null;
  currency: string | null;
  lineExtensionTotal: number | null;
  taxExclusiveTotal: number | null;
  taxInclusiveTotal: number | null;
  payableTotal: number | null;
  allowances: DocAllowance[];
  lines: StructuredLine[];
  /** Ting tolkningen ikke tok med (f.eks. underlinjer). */
  notes: string[];
}

/** Linjetype ut fra tekst og fortegn. Samme ordbruk som leseren bruker for pant/frakt/gebyr/avgift. */
export function classifyLine(text: string | null, lineTotal: number | null): LineKind {
  const t = (text ?? "").toLowerCase();
  if (/\bpant\b|panteavgift|pant\s*\d/.test(t)) return "pant";
  if (/frakt|transport|leveringsgebyr|levering\b|porto/.test(t)) return "frakt";
  if (/gebyr|ekspedisjon|småordre|fakturaavgift/.test(t)) return "gebyr";
  if (/avgift|miljø|vederlag|grønt punkt|emballasje/.test(t)) return "avgift";
  if (lineTotal != null && lineTotal < 0 && /rabatt|bonus|kreditt/.test(t)) return "rabatt";
  return "vare";
}

export const emptyLine = (index: number): StructuredLine => ({
  index, lineId: null, sellerSku: null, buyerSku: null, gtin: null, gtinScheme: null, name: null, description: null,
  quantity: null, unitCode: null, unitPrice: null, grossUnitPrice: null, baseQuantity: null, discount: null, discountPct: null,
  charge: null, lineTotal: null, vatPercent: null, vatCategory: null, packSize: null, packQuantity: null, kind: "vare",
});

export const round2 = (n: number) => Math.round(n * 100) / 100;
