// Rene hjelpere for «Les originalen på nytt» (edge reread-invoice-preview). Ingen Deno-/nettleser-API-er,
// testes i vitest. Kontrakt: forslag lagres bare via rm_register_invoice_reread, aldri i fakturaen.
//
// Regler:
//  - Kontrolltall hentes fra lagret snapshot (signert som lagret). Ukjent mva blir aldri 0.
//  - Ekstraktorens `sku` → `supplier_sku`, `price_basis` (databaseverdi) → `unit_price_basis`.
//    Modellens `unit_price_basis` (per_unit/per_base) lagres bare som bevis.
//  - Ukjente verdier forblir null. Ingen sikkerhet oppfinnes. Ingen varsler forsvinner.

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_CANDIDATES = 500;
export const MAX_PROPOSAL_BYTES = 2_000_000;
export const MAX_EXTRACTOR_BYTES = 20_000;

const LINE_KINDS = ["vare", "pant", "frakt", "gebyr", "rabatt", "avrunding", "mva", "annet"];
const DB_BASIS = ["mengdeenhet", "pakning", "stk", "kg", "g", "l", "ml"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const finiteOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, 2000) : null);

/** Lagringsstien må ligge i selskapets eget navnerom (`<legal_entity_id>/...`), uten traversering eller URL. */
export function documentPathAllowed(path: unknown, legalEntityId: unknown): boolean {
  if (typeof path !== "string" || typeof legalEntityId !== "string" || !UUID.test(legalEntityId)) return false;
  if (path.length < 40 || path.length > 1024) return false;
  if (/^[a-z]+:/i.test(path) || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  return parts[0].toLowerCase() === legalEntityId.toLowerCase() && parts.length >= 2;
}

/** Ekte PDF-bytes: starter med %PDF- innen de første 1024 byte og har rimelig størrelse. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 64 || bytes.byteLength > MAX_PDF_BYTES) return false;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(1024, bytes.byteLength)));
  return head.includes("%PDF-");
}

export interface SnapshotInvoice { supplier_id: string | null; invoice_number: string | null; is_credit_note: boolean | null; total_amount: unknown; total_vat: unknown; legal_entity_id?: string }
export interface SnapshotLine { supplier_sku: string | null; description: string | null }

/** Ekstraktorforespørsel bygget KUN fra lagret snapshot. Fakturaens total er inkl. mva. */
export function buildExtractorRequest(a: { legalEntityId: string; invoice: SnapshotInvoice; lines: SnapshotLine[]; supplierName: string | null; pdfBase64: string }) {
  const incl = finiteOrNull(a.invoice.total_amount);
  const vat = finiteOrNull(a.invoice.total_vat);
  return {
    legal_entity_id: a.legalEntityId,
    supplier_id: a.invoice.supplier_id,
    supplier_name: a.supplierName,
    invoice_number: a.invoice.invoice_number,
    pdf_base64: a.pdfBase64,
    is_credit: a.invoice.is_credit_note === true,
    expected_total_incl_vat: incl,
    expected_vat: vat,
    expected_total_excl_vat: incl != null && vat != null ? Math.round((incl - vat) * 100) / 100 : null,
    known_items: a.lines.map((l) => ({ sku: l.supplier_sku, name: l.description })),
    max_attempts: 2,
  };
}

export type CandidateValues = {
  supplier_sku: string | null; description: string | null; quantity: number | null; unit: string | null;
  unit_price: number | null; total_amount: number | null; package_size: number | null; package_unit: string | null;
  count_per_package: number | null; line_kind: string | null; unit_price_basis: string | null; discount_amount: number | null;
};
export type Issue = { code: string; message: string; [k: string]: unknown };
export type Candidate = { candidate_id: string; values: CandidateValues; issues: Issue[]; evidence: Rec };

function issuesOf(v: unknown): Issue[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRec).map((i) => ({ ...i, code: typeof i.code === "string" ? i.code : "lesevarsel", message: typeof i.message === "string" ? i.message : String(i.code ?? "Lesevarsel") }));
}

/** Én ekstraktorlinje → kandidat. Verdier som databasen ville avvist blir null + eget varsel (ikke stille). */
export function mapLine(line: Rec, index: number): Candidate {
  const dropped: Issue[] = [];
  const pos = (k: string, v: unknown, strict: boolean) => {
    const n = finiteOrNull(v);
    if (n == null) return null;
    if (strict ? n <= 0 : n < 0) { dropped.push({ code: "reread_value_dropped", message: `Ugyldig ${k} (${n}) ble ikke foreslått.`, field: k }); return null; }
    return n;
  };
  const kind = typeof line.line_kind === "string" && LINE_KINDS.includes(line.line_kind) ? line.line_kind : null;
  const basis = typeof line.price_basis === "string" && DB_BASIS.includes(line.price_basis) ? line.price_basis : null;
  if (typeof line.price_basis === "string" && basis == null) dropped.push({ code: "reread_value_dropped", message: `Ukjent prisgrunnlag «${line.price_basis}» ble ikke foreslått.`, field: "unit_price_basis" });
  const values: CandidateValues = {
    supplier_sku: strOrNull(line.sku),
    description: strOrNull(line.description),
    quantity: finiteOrNull(line.quantity),
    unit: strOrNull(line.unit),
    unit_price: finiteOrNull(line.unit_price),
    total_amount: finiteOrNull(line.total_amount),
    package_size: pos("pakningsstørrelse", line.package_size, true),
    package_unit: strOrNull(line.package_unit),
    count_per_package: pos("antall per pakning", line.count_per_package, true),
    line_kind: kind,
    unit_price_basis: basis,
    discount_amount: pos("rabatt", line.discount_amount, false),
  };
  const confidence = typeof line.confidence === "number" && Number.isFinite(line.confidence) ? line.confidence : null;
  return {
    candidate_id: `line-${index}`,
    values,
    issues: [...issuesOf(line.read_issues), ...dropped],
    evidence: {
      confidence,
      number_evidence: Array.isArray(line.number_evidence) ? line.number_evidence : [],
      model_price_basis: line.unit_price_basis ?? null,
      ean: line.ean ?? null,
      vat_rate: line.vat_rate ?? null,
      discount_pct: line.discount_pct ?? null,
      original: line,
    },
  };
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).byteLength;

export type BuildResult =
  | { ok: true; proposal: Rec; extractor: Rec }
  | { ok: false; code: "leser_ugyldig_svar" | "leser_ingen_linjer" | "forslag_for_stort" | "for_mange_linjer" };

/** Ekstraktorsvar → persistert forslag + avgrenset metadata. Null linjer = feilet lesing (vises, kan ikke tas i bruk). */
export function buildProposal(resp: unknown, snapshot: { invoice: SnapshotInvoice & Rec }): BuildResult {
  if (!isRec(resp) || !isRec(resp.extracted)) return { ok: false, code: "leser_ugyldig_svar" };
  const ex = resp.extracted;
  if (ex.lines != null && !Array.isArray(ex.lines)) return { ok: false, code: "leser_ugyldig_svar" };
  const rawLines = (Array.isArray(ex.lines) ? ex.lines : []).filter(isRec);
  if (rawLines.length === 0) return { ok: false, code: "leser_ingen_linjer" };
  if (rawLines.length > MAX_CANDIDATES) return { ok: false, code: "for_mange_linjer" };
  const candidates = rawLines.map(mapLine);
  const { lines: _l, ...headerRead } = ex;
  const inv = snapshot.invoice;
  const diffs: Rec = {};
  const cmp = (k: string, oldV: unknown, newV: unknown) => { if (newV != null && String(oldV ?? "") !== String(newV)) diffs[k] = { old: oldV ?? null, new: newV }; };
  cmp("invoice_number", inv.invoice_number, ex.invoice_number);
  cmp("invoice_date", inv.invoice_date, ex.invoice_date);
  cmp("total_amount", inv.total_amount, ex.total_amount);
  cmp("total_vat", inv.total_vat, ex.total_vat);
  cmp("currency", inv.currency, ex.currency);
  const warnings = Array.isArray(resp.warnings) ? resp.warnings.map(String) : [];
  const sum = isRec(resp.sum_check) ? resp.sum_check : {};
  const invoice_issues: Issue[] = [
    ...issuesOf(sum.issues),
    ...warnings.map((w) => ({ code: "reread_warning", message: w })),
  ];
  const proposal = {
    header: {
      read: headerRead,
      matched_supplier: resp.matched_supplier ?? null,
      name_matched_supplier: resp.name_matched_supplier ?? null,
      differences: diffs,
      is_credit_note: inv.is_credit_note === true,
    },
    invoice_issues,
    candidates,
  };
  const sumMeta = { lines_sum: sum.lines_sum ?? null, expected_excl_vat: sum.expected_excl_vat ?? null, deviation_pct: sum.deviation_pct ?? null, missing_amount: sum.missing_amount ?? null, arithmetic_issue_lines: sum.arithmetic_issue_lines ?? null, examples_used: sum.examples_used ?? null, issue_count: Array.isArray(sum.issues) ? sum.issues.length : 0 };
  const extractor: Rec = {
    extraction_method: typeof resp.extraction_method === "string" ? resp.extraction_method : null,
    confidence: typeof resp.confidence === "number" && Number.isFinite(resp.confidence) ? resp.confidence : null,
    attempts: finiteOrNull(resp.attempts),
    ai_usage: isRec(resp.ai_usage) ? { in: resp.ai_usage.in ?? null, out: resp.ai_usage.out ?? null, cost: resp.ai_usage.cost ?? null } : null,
    sum_check: sumMeta,
    warning_count: warnings.length,
    // Alle varsler ligger i forslagets invoice_issues; her står bare antallet så metadata holder seg under grensen.
    warnings_in_proposal: true,
  };
  if (bytes(proposal) > MAX_PROPOSAL_BYTES || bytes(extractor) > MAX_EXTRACTOR_BYTES) return { ok: false, code: "forslag_for_stort" };
  return { ok: true, proposal, extractor };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(data: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) s += String.fromCharCode(...data.subarray(i, i + chunk));
  return btoa(s);
}
