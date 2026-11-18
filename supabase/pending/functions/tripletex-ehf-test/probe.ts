// EHF-test (18.11.2026): ren hjelpelogikk for den lesende testfunksjonen. Ingen Deno- eller nettleser-API-er,
// slik at vitest kan teste den direkte (src/test/ehfTestProbe.test.ts).

export type ContentKind = "json" | "xml" | "pdf" | "zip" | "tom" | "tekst" | "ukjent";

/** Hva slags innhold et svar inneholder, ut fra de første bytene (ikke Content-Type alene). */
export function sniffContent(bytes: Uint8Array, contentType: string | null): ContentKind {
  if (bytes.length === 0) return "tom";
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf"; // %PDF
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip"; // PK..
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i++;
  if (b[i] === 0x3c) return "xml"; // <
  if (b[i] === 0x7b || b[i] === 0x5b) return "json"; // { [
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("text/")) return "tekst";
  return "ukjent";
}

/** Rotelementets lokale navn (Invoice, CreditNote, StandardBusinessDocument …) eller null. */
export function xmlRootName(xml: string): string | null {
  const re = /<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)[\s/>]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const before = xml.slice(Math.max(0, m.index), m.index + 2);
    if (before.startsWith("<?") || before.startsWith("<!")) continue;
    return m[2];
  }
  return null;
}

/** Finnes en UBL-faktura eller kreditnota i XML-en (også inne i en SBDH-konvolutt)? */
export function containsUbl(xml: string): "Invoice" | "CreditNote" | null {
  if (/<([\w.-]+:)?Invoice[\s>]/.test(xml)) return "Invoice";
  if (/<([\w.-]+:)?CreditNote[\s>]/.test(xml)) return "CreditNote";
  return null;
}

/**
 * Fjerner innebygde vedlegg (base64-PDF i EmbeddedDocumentBinaryObject) før XML sendes til nettleseren.
 * Linjene påvirkes ikke; antall og fjernet størrelse rapporteres.
 */
export function stripEmbeddedBinaries(xml: string): { xml: string; removed: number; removedBytes: number } {
  let removed = 0;
  let removedBytes = 0;
  const out = xml.replace(
    /(<([\w.-]+:)?EmbeddedDocumentBinaryObject\b[^>]*>)([\s\S]*?)(<\/([\w.-]+:)?EmbeddedDocumentBinaryObject>)/g,
    (_all, open: string, _p: string, body: string, close: string) => {
      removed++;
      removedBytes += body.length;
      return `${open}${close}`;
    },
  );
  return { xml: out, removed, removedBytes };
}

/** Tripletex' feiltekst i klartekst (message + validationMessages), maks 500 tegn. */
export function tripletexMessage(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof j.message === "string" && j.message) parts.push(j.message);
    const vm = j.validationMessages;
    if (Array.isArray(vm)) {
      for (const v of vm) {
        if (v && typeof v === "object" && typeof (v as { message?: unknown }).message === "string") {
          const f = (v as { field?: unknown }).field;
          parts.push(`${typeof f === "string" && f ? `${f}: ` : ""}${(v as { message: string }).message}`);
        }
      }
    }
    if (typeof j.developerMessage === "string" && j.developerMessage) parts.push(j.developerMessage);
    const joined = [...new Set(parts)].join(" · ");
    return joined ? joined.slice(0, 500) : text.slice(0, 500);
  } catch {
    return text.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  }
}

const isId = (v: unknown): v is number | string =>
  (typeof v === "number" && Number.isInteger(v) && v > 0) || (typeof v === "string" && /^\d+$/.test(v));

/**
 * Dokument-ID-er som kan peke til originalen: fakturaens originalInvoiceDocumentId og bilagets
 * ediDocument / attachment / document. Rekkefølge: EHF-dokument først.
 */
export function documentIdsFrom(
  supplierInvoice: Record<string, unknown> | null,
  voucher: Record<string, unknown> | null,
): Array<{ id: string; source: string }> {
  const out: Array<{ id: string; source: string }> = [];
  const add = (v: unknown, source: string) => {
    const id = isId(v) ? String(v) : v && typeof v === "object" && isId((v as { id?: unknown }).id) ? String((v as { id: unknown }).id) : null;
    if (id && !out.some((o) => o.id === id)) out.push({ id, source });
  };
  if (voucher) add(voucher.ediDocument, "bilag.ediDocument");
  if (supplierInvoice) add(supplierInvoice.originalInvoiceDocumentId, "leverandørfaktura.originalInvoiceDocumentId");
  if (supplierInvoice) {
    const v = supplierInvoice.voucher;
    if (v && typeof v === "object") add((v as Record<string, unknown>).ediDocument, "leverandørfaktura.voucher.ediDocument");
  }
  if (voucher) add(voucher.attachment, "bilag.attachment");
  if (voucher) add(voucher.document, "bilag.document");
  return out;
}

/** Felt-utvalg som prøves i rekkefølge; Tripletex svarer 400 på ukjente felt, da prøves neste. */
export const SUPPLIER_INVOICE_FIELDS = [
  "*,voucher(id,number,ediDocument(id,fileName,mimeType,size),attachment(id,fileName,mimeType,size)),orderLines(*,product(id,number,name,ean),vatType(id,number,percentage))",
  "*,orderLines(*)",
  "*",
];
export const VOUCHER_FIELDS = [
  "id,number,date,description,ediDocument(id,fileName,mimeType,size),attachment(id,fileName,mimeType,size),document(id,fileName,mimeType,size)",
  "id,number,ediDocument(*),attachment(*)",
  "*",
];

/** Tripletex' JSON-svar er enten { value: … } eller selve objektet. */
export function unwrapValue(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (r.value && typeof r.value === "object" && !Array.isArray(r.value)) return r.value as Record<string, unknown>;
  return r;
}

/** Maks størrelse vi leser fra ett svar; større svar logges med størrelse, men innholdet sendes ikke videre. */
export const MAX_CONTENT_BYTES = 15 * 1024 * 1024;
/** Maks XML-tekst som sendes til nettleseren etter at innebygde vedlegg er fjernet. */
export const MAX_XML_CHARS = 4 * 1024 * 1024;
