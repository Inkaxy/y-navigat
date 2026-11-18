// EHF-test: henting av testfakturaer (bare lesing) og kall til den lesende testfunksjonen tripletex-ehf-test.
import { supabase } from "@/integrations/supabase/client";
import type { PdfLine } from "./compare";

export const EHF_TEST_FUNCTION = "tripletex-ehf-test";

export interface ProbeLog {
  step: string;
  path: string;
  status: number | null;
  contentType: string | null;
  bytes: number;
  kind: string;
  note: string | null;
  tripletexMessage: string | null;
}

export interface ProbeXml {
  documentId: string;
  source: string;
  root: string | null;
  ubl: "Invoice" | "CreditNote" | null;
  text: string;
  removedEmbedded: number;
  removedBytes: number;
  truncated: boolean;
}

export interface ProbeResponse {
  invoiceId: string;
  supplierInvoiceId: string | null;
  voucherId: string | null;
  probes: ProbeLog[];
  supplierInvoice: { invoiceNumber: string | null; amount: number | null; amountExclVat: number | null; isCreditNote: boolean | null } | null;
  xml: ProbeXml | null;
  orderLines: unknown[] | null;
  incoming: unknown;
}

export type RunOutcome =
  | { kind: "ok"; data: ProbeResponse }
  | { kind: "ikke_utrullet" }
  | { kind: "avvist"; status: number; code: string | null; message: string }
  | { kind: "ukjent"; message: string };

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseProbe(v: unknown): ProbeLog | null {
  const r = rec(v);
  if (!r || typeof r.step !== "string" || typeof r.path !== "string" || typeof r.bytes !== "number" || typeof r.kind !== "string") return null;
  return {
    step: r.step, path: r.path, status: numOrNull(r.status), contentType: str(r.content_type), bytes: r.bytes, kind: r.kind,
    note: str(r.note), tripletexMessage: str(r.tripletex_message),
  };
}

/** Streng lesing av testfunksjonens svar; alt som ikke har riktig form er null. */
export function parseProbeResponse(v: unknown): ProbeResponse | null {
  const r = rec(v);
  if (!r || r.ok !== true || typeof r.invoice_id !== "string" || !Array.isArray(r.probes)) return null;
  const probes = r.probes.map(parseProbe);
  if (probes.some((p) => p === null)) return null;
  const tt = rec(r.tripletex);
  const si = rec(r.supplier_invoice);
  const x = rec(r.xml);
  let xml: ProbeXml | null = null;
  if (x) {
    if (typeof x.document_id !== "string" || typeof x.text !== "string") return null;
    xml = {
      documentId: x.document_id, source: str(x.source) ?? "", root: str(x.root),
      ubl: x.ubl === "Invoice" || x.ubl === "CreditNote" ? x.ubl : null, text: x.text,
      removedEmbedded: numOrNull(x.removed_embedded) ?? 0, removedBytes: numOrNull(x.removed_bytes) ?? 0, truncated: x.truncated === true,
    };
  }
  return {
    invoiceId: r.invoice_id,
    supplierInvoiceId: tt ? str(tt.supplier_invoice_id) : null,
    voucherId: tt ? str(tt.voucher_id) : null,
    probes: probes as ProbeLog[],
    supplierInvoice: si ? {
      invoiceNumber: str(si.invoice_number), amount: numOrNull(si.amount), amountExclVat: numOrNull(si.amount_excl_vat),
      isCreditNote: typeof si.is_credit_note === "boolean" ? si.is_credit_note : null,
    } : null,
    xml,
    orderLines: Array.isArray(r.order_lines) ? r.order_lines : null,
    incoming: r.incoming_invoice ?? null,
  };
}

/** Tolker et mislykket kall. 404 uten vårt eget svarformat betyr at funksjonen ikke er rullet ut. */
export function classifyFailure(status: number | null, body: unknown): RunOutcome {
  const b = rec(body);
  if (status === 404 && (!b || b.ok !== false)) return { kind: "ikke_utrullet" };
  if (status != null && b && b.ok === false) {
    return { kind: "avvist", status, code: str(b.code), message: str(b.message) ?? "Kallet ble avvist." };
  }
  if (status != null) return { kind: "avvist", status, code: null, message: `Testfunksjonen svarte med status ${status}.` };
  return { kind: "ukjent", message: "Fikk ikke svar fra testfunksjonen. Den er kanskje ikke rullet ut ennå, eller nettet falt ut." };
}

export async function runEhfProbe(legalEntityId: string, invoiceId: string): Promise<RunOutcome> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await supabase.functions.invoke(EHF_TEST_FUNCTION, { body: { legal_entity_id: legalEntityId, invoice_id: invoiceId } }));
  } catch {
    return classifyFailure(null, null);
  }
  if (!error) {
    const parsed = parseProbeResponse(data);
    return parsed ? { kind: "ok", data: parsed } : { kind: "ukjent", message: "Svaret fra testfunksjonen hadde uventet form." };
  }
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    const body = await ctx.clone().json().catch(() => null);
    return classifyFailure(ctx.status, body);
  }
  return classifyFailure(null, null);
}

/** Leverandører hentet fra Tripletex der fakturalinjer leses (de som har PDF-leste fakturaer). */
export interface EhfSupplier { id: string; name: string }

export async function fetchEhfSuppliers(legalEntityId: string): Promise<EhfSupplier[]> {
  const { data, error } = await supabase.from("suppliers").select("id, name")
    .eq("legal_entity_id", legalEntityId).eq("track_invoice_lines", true).not("tripletex_supplier_id", "is", null).order("name").range(0, 999);
  if (error) throw new Error("Kunne ikke hente leverandørene.");
  return (data ?? []).map((s) => ({ id: s.id, name: s.name }));
}

export interface PickedInvoice {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number | null;
  totalVat: number | null;
  isCredit: boolean;
  linesSumStatus: string;
  pdfLines: PdfLine[];
}

const LINE_COLS = "id, invoice_id, line_number, supplier_sku, description, quantity, unit, unit_price, discount_amount, total_amount, vat_rate, line_kind, package_size, package_unit";

async function fetchLines(invoiceIds: string[]): Promise<Map<string, PdfLine[]>> {
  const out = new Map<string, PdfLine[]>();
  if (invoiceIds.length === 0) return out;
  const { count, error: cErr } = await supabase.from("invoice_lines").select("id", { count: "exact", head: true }).in("invoice_id", invoiceIds);
  if (cErr || count == null) throw new Error("Kunne ikke telle fakturalinjene.");
  let fetched = 0;
  for (let from = 0; fetched < count; from += 1000) {
    const { data, error } = await supabase.from("invoice_lines").select(LINE_COLS).in("invoice_id", invoiceIds)
      .order("invoice_id").order("line_number", { nullsFirst: false }).order("id").range(from, from + 999);
    if (error) throw new Error("Kunne ikke hente fakturalinjene.");
    const rows = data ?? [];
    if (rows.length === 0) break;
    fetched += rows.length;
    for (const l of rows) {
      const list = out.get(l.invoice_id) ?? [];
      list.push({
        id: l.id, lineNumber: l.line_number, sku: l.supplier_sku, description: l.description, quantity: l.quantity, unit: l.unit,
        unitPrice: l.unit_price, discount: l.discount_amount, lineTotal: l.total_amount, vatRate: l.vat_rate, lineKind: l.line_kind,
        packageSize: l.package_size, packageUnit: l.package_unit,
      });
      out.set(l.invoice_id, list);
    }
  }
  if (fetched < count) throw new Error("Fikk ikke hentet alle fakturalinjene.");
  return out;
}

/** 1–3 nyeste fakturaer per leverandør som er hentet fra Tripletex og lest fra PDF (minst én linje). */
export async function pickTestInvoices(legalEntityId: string, suppliers: EhfSupplier[], perSupplier: number): Promise<PickedInvoice[]> {
  const n = Math.max(1, Math.min(3, Math.floor(perSupplier)));
  const candidates: Array<Omit<PickedInvoice, "pdfLines">> = [];
  for (const s of suppliers) {
    const { data, error } = await supabase.from("invoices")
      .select("id, invoice_number, invoice_date, total_amount, total_vat, is_credit_note, lines_sum_status")
      .eq("legal_entity_id", legalEntityId).eq("supplier_id", s.id).eq("lines_source", "pdf_extracted")
      .not("tripletex_supplier_invoice_id", "is", null)
      .order("invoice_date", { ascending: false }).order("id").limit(n + 5);
    if (error) throw new Error(`Kunne ikke hente fakturaer for ${s.name}.`);
    for (const r of data ?? []) candidates.push({
      id: r.id, supplierId: s.id, supplierName: s.name, invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date,
      totalAmount: r.total_amount, totalVat: r.total_vat, isCredit: r.is_credit_note, linesSumStatus: r.lines_sum_status,
    });
  }
  const lines = await fetchLines(candidates.map((c) => c.id));
  const picked: PickedInvoice[] = [];
  const perSup = new Map<string, number>();
  for (const c of candidates) {
    const l = lines.get(c.id) ?? [];
    const k = perSup.get(c.supplierId) ?? 0;
    if (l.length === 0 || k >= n) continue;
    perSup.set(c.supplierId, k + 1);
    picked.push({ ...c, pdfLines: l });
  }
  return picked;
}
