// EHF-test: Tripletex' strukturerte ordrelinjer (SupplierInvoice.orderLines eller inngående faktura, beta).
// Feltnavnene er ikke garantert; alt som mangler blir null. Produktet er Tripletex' eget, ikke nødvendigvis
// leverandørens varenummer – det står i rapporten.
import { classifyLine, emptyLine, type StructuredDoc, type StructuredLine, type StructuredSource } from "./structured";

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const first = (r: Record<string, unknown>, keys: string[], f: (v: unknown) => number | null) => {
  for (const k of keys) { const x = f(r[k]); if (x != null) return x; }
  return null;
};

/** En linje som bare er en referanse ({ id, url }) har ikke innhold og telles ikke. */
function hasContent(r: Record<string, unknown>): boolean {
  return Object.keys(r).some((k) => k !== "id" && k !== "url" && k !== "version" && k !== "changes" && r[k] != null);
}

export function parseOrderLines(raw: unknown, source: StructuredSource = "ordrelinjer"): StructuredDoc | null {
  if (!Array.isArray(raw)) return null;
  const rows = raw.map(rec).filter((r): r is Record<string, unknown> => !!r && hasContent(r));
  if (rows.length === 0) return null;
  const lines: StructuredLine[] = rows.map((r, i) => {
    const line = emptyLine(i);
    const product = rec(r.product);
    const vat = rec(r.vatType);
    line.lineId = s(r.id);
    line.description = s(r.description);
    line.name = s(product?.name) ?? null;
    line.sellerSku = s(product?.number);
    line.gtin = s(product?.ean);
    line.gtinScheme = line.gtin ? "EAN (Tripletex-produkt)" : null;
    line.quantity = first(r, ["count", "quantity"], n);
    line.unitPrice = first(r, ["unitPriceExcludingVatCurrency", "unitCostCurrency", "unitPriceExcludingVat", "unitPrice"], n);
    line.discountPct = first(r, ["discount"], n);
    line.lineTotal = first(r, ["amountExcludingVatCurrency", "amountExcludingVat", "amount"], n);
    line.vatPercent = vat ? n(vat.percentage) : null;
    if (line.discountPct != null && line.quantity != null && line.unitPrice != null) {
      line.discount = Math.round(line.quantity * line.unitPrice * line.discountPct) / 100;
    }
    line.kind = classifyLine(`${line.name ?? ""} ${line.description ?? ""}`, line.lineTotal);
    return line;
  });
  return {
    source, docType: null, invoiceNumber: null, currency: null, lineExtensionTotal: null, taxExclusiveTotal: null,
    taxInclusiveTotal: null, payableTotal: null, allowances: [], lines,
    notes: ["Tripletex-ordrelinjer: «varenummer» er Tripletex-produktets nummer, ikke nødvendigvis leverandørens."],
  };
}

/** Inngående faktura (beta): leter etter en linjeliste under kjente navn. */
export function parseIncomingInvoice(raw: unknown): StructuredDoc | null {
  const r = rec(raw);
  if (!r) return null;
  for (const key of ["orderLines", "invoiceLines", "lines"]) {
    const d = parseOrderLines(r[key], "inngaaende");
    if (d) return d;
  }
  return null;
}
