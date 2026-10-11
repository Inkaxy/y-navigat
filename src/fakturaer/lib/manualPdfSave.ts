import { readingReliability } from "@/fakturaer/lib/invoiceFacts";

/** Tallbevis fra leseren (råtekst → tolket verdi). Lagres uendret som i Tripletex-importen. */
export type NumberEvidenceItem = { field: string; raw: string | null; value: number | null; how: string | null };
export type ReadIssueItem = { code: string; message: string };

export interface PdfLine {
  description: string | null;
  sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  vat_rate: number | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  line_kind?: string | null;
  price_basis?: string | null;
  discount_amount?: number | null;
  /** Fra leseren; urørt av brukeren. */
  confidence?: number | null;
  read_issues?: ReadIssueItem[];
  number_evidence?: NumberEvidenceItem[];
  /** Tallfeltene slik leseren leverte dem – for å se om brukeren har endret linjen. */
  original?: Pick<PdfLine, "quantity" | "unit_price" | "total_amount"> | null;
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Gyldig sikkerhet er et tall i [0,1]. Alt annet (manglende, NaN, 100) er ukjent. */
export function validConfidence(v: unknown): number | null {
  const n = numOrNull(v);
  return n != null && n >= 0 && n <= 1 ? n : null;
}

export function parseReadIssues(v: unknown): ReadIssueItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRec).filter((e) => typeof e.code === "string" && e.code !== "")
    .map((e) => ({ code: String(e.code), message: typeof e.message === "string" ? e.message : "" }));
}

export function parseNumberEvidence(v: unknown): NumberEvidenceItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRec).filter((e) => typeof e.field === "string")
    .map((e) => ({ field: String(e.field), raw: strOrNull(e.raw), value: numOrNull(e.value), how: strOrNull(e.how) }));
}

/** Leserens linje → redigerbar linje med bevis og originalverdier bevart. */
export function lineFromExtraction(raw: unknown): PdfLine {
  const l = isRec(raw) ? raw : {};
  const quantity = numOrNull(l.quantity), unit_price = numOrNull(l.unit_price), total_amount = numOrNull(l.total_amount);
  return {
    description: strOrNull(l.description), sku: strOrNull(l.sku), quantity, unit: strOrNull(l.unit), unit_price, total_amount,
    vat_rate: numOrNull(l.vat_rate), package_size: numOrNull(l.package_size), package_unit: strOrNull(l.package_unit),
    count_per_package: numOrNull(l.count_per_package), line_kind: strOrNull(l.line_kind), price_basis: strOrNull(l.price_basis),
    discount_amount: numOrNull(l.discount_amount), confidence: validConfidence(l.confidence),
    read_issues: parseReadIssues(l.read_issues), number_evidence: parseNumberEvidence(l.number_evidence),
    original: { quantity, unit_price, total_amount },
  };
}

export function lineEdited(l: PdfLine): boolean {
  if (!l.original) return true;
  return l.original.quantity !== l.quantity || l.original.unit_price !== l.unit_price || l.original.total_amount !== l.total_amount;
}

/** Rad til `rm_save_manual_pdf_invoice` — samme feltnavn og bevis som Tripletex-finaliseringen. */
export function rowPayload(l: PdfLine, idx: number) {
  const fromReader = l.original != null;
  return {
    line_number: idx + 1,
    description: l.description ?? `Linje ${idx + 1}`,
    supplier_sku: l.sku, quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, total_amount: l.total_amount,
    vat_rate: l.vat_rate, package_size: l.package_size, package_unit: l.package_unit, count_per_package: l.count_per_package,
    line_kind: l.line_kind ?? null, unit_price_basis: l.price_basis ?? null, discount_amount: l.discount_amount ?? null,
    read_issues: l.read_issues ?? [],
    evidence: fromReader ? { confidence: l.confidence ?? null, number_evidence: l.number_evidence ?? [], edited_by_user: lineEdited(l) } : null,
  };
}

/** Lesesikkerhet med samme ordlyd som fakturaarbeidsflaten. Rå AI-score er aldri «bekreftet» uten at kontrollen går opp. */
export function manualReading(input: { confidence: unknown; linesSumStatus: string | null; lines: readonly PdfLine[]; invoiceIssues: number }) {
  const conf = validConfidence(input.confidence);
  const issueCount = input.invoiceIssues + input.lines.reduce((s, l) => s + (l.read_issues?.length ?? 0), 0);
  const missingLineConf = input.lines.some((l) => l.original != null && l.confidence == null);
  const r = readingReliability({ confidence: conf, linesSumStatus: input.linesSumStatus === "ok" ? "ok" : null, readIssueCount: issueCount });
  const confirmed = r.validated && conf != null && conf >= 0.8 && !missingLineConf && issueCount === 0 && input.linesSumStatus === "ok";
  const label = conf == null && issueCount === 0 ? "Ikke bekreftet – lesesikkerhet mangler"
    : !confirmed && !r.label.startsWith("Ikke") ? `${r.label}, ikke bekreftet` : r.label;
  return { label, rawScore: r.rawScore, confirmed, issueCount, missingLineConf };
}

export type ManualSaveResult =
  | { ok: true; invoiceId: string; supplierId: string; replayed: boolean; status: string; lines: number }
  | { ok: false; code: string; invoiceId: string | null };

export function parseManualSaveResult(data: unknown): ManualSaveResult {
  if (!isRec(data)) return { ok: false, code: "ukjent_svar", invoiceId: null };
  if (data.ok === true && typeof data.invoice_id === "string" && typeof data.supplier_id === "string") {
    return { ok: true, invoiceId: data.invoice_id, supplierId: data.supplier_id, replayed: data.replayed === true,
      status: typeof data.status === "string" ? data.status : "imported", lines: numOrNull(data.lines) ?? 0 };
  }
  return { ok: false, code: typeof data.code === "string" ? data.code : "ukjent_svar", invoiceId: typeof data.invoice_id === "string" ? data.invoice_id : null };
}

const SAVE_ERRORS: Record<string, string> = {
  duplikat: "Fakturanummeret finnes allerede for denne leverandøren. Ingenting ble lagret.",
  mangler_fakturanr_eller_dato: "Fyll inn fakturanr og fakturadato.",
  mangler_leverandor: "Velg eller opprett leverandør.",
  leverandor_finnes_ikke: "Leverandøren finnes ikke i dette selskapet.",
  ugyldig_dokument: "PDF-en hører ikke til dette selskapet.",
  ugyldige_linjer: "Linjene kunne ikke leses. Ingenting ble lagret.",
};
export function manualSaveErrorMessage(code: string): string {
  return SAVE_ERRORS[code] ?? "Lagringen feilet. Ingenting ble lagret – prøv igjen.";
}
