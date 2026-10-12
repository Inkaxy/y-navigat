import { createContext, useContext } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllCounted } from "@/lib/countedPaging";
import { rejectOrUnknown, VtBackendUnavailableError, VtRejectedError, VtUnknownOutcomeError, type VtApi } from "./api";
import { parseSaveLine, rec, type EntryInput, type LineState, type SaveLineResult } from "./types";
import { buildManifest, matchDocument, rowCodeOf, type OcrDoc, type ProposalEntry } from "../../../supabase/pending/functions/vt-count-ocr/ocrCore";
import { buildReportCsv, summarizeLines, type VtReportData, type VtSummary } from "../../../supabase/pending/functions/_shared/vtReport";

/**
 * Trinn 3 (revisjon 2): listebundet opplasting med lese-FORSLAG, rapport-e-post og tildeling.
 * Egen sonde (vt_stage3_version = 2). Uten utrullet SQL/Edge viser UI at funksjonen ikke er tatt i bruk.
 */
export type OcrJobStatus = "opprettet" | "behandler" | "ukjent_ai_utfall" | "klar" | "feilet";
export interface VtOriginal { path: string; sha256: string; size: number; mime: string; role: "side" | "original"; /** For avledet side: indeks til bevart original (f.eks. WEBP). */ original_index: number | null }
/** Serverens kobling fra lest side til kildefil og side i filen (1-basert). */
export interface VtPageSource { file_index: number; file_page: number; original_index: number | null }
export interface VtOcrJob {
  id: string; count_list_id: string; status: OcrJobStatus; document_ok: boolean | null; issues: string[]; detail: string | null;
  created_at: string; originals: VtOriginal[]; attempts: number; lease_until: string | null; page_count: number | null;
  /** Per lest side i opplastingsrekkefølge. Tom for eldre/ulest jobb. */ page_sources: VtPageSource[];
}
export interface VtOcrProposal {
  id: string; job_id: string; line_id: string; line_revision_at_job: number; page: number; row_code: string;
  /** Lest side (0-basert) og serverens kildekobling; null = ukjent kilde (vises ikke som en tilfeldig side). */
  upload_index: number | null; source: VtPageSource | null;
  entries: ProposalEntry[]; reasons: string[]; status: "foreslatt" | "godkjent" | "avvist";
}
export interface ReportPreview { hash: string; countRevision: number; final: boolean; defaultSubject: string; attachmentBase: string; csv: string; pdfB64: string; totals: VtSummary; mailConfigured: boolean; /** Tilkoblet Microsoft 365-postboks som vil sende (vises i forhåndsvisningen). */ sender: string | null }
export type MailState = "akseptert_av_tjenesten" | "avvist" | "ukjent" | "reservert" | "sender";
export interface MailStatus { found: boolean; state: MailState | null; detail: string | null }
export interface VtAssignment { id: string; count_list_id: string; user_id: string; role: "teller" | "kontrollor" }
export interface VtUnit { id: string; raw_material_id: string; label: string; units_in_base: number }
export type ClarSource = "faktura" | "leverandorpris" | "prisliste" | "manuell_vurdering";
export interface VtClarification { id: string; line_id: string; price_per_base: number; source_kind: ClarSource; source_ref: string | null; reason: string; decided_at: string; superseded_at: string | null }
export interface VtUser { id: string; name: string }
/** Kalles før hvert eksternt steg; false = konteksten er byttet ⇒ stopp uten flere sideeffekter. */
export type Guard = () => boolean;
export class VtStaleContextError extends Error { constructor() { super("Visningen er byttet. Ingenting mer ble gjort."); } }

export interface Stage3Api {
  probe(): Promise<"ok" | "missing">;
  listJobs(entity: string, listId: string): Promise<VtOcrJob[]>;
  listProposals(entity: string, jobId: string): Promise<VtOcrProposal[]>;
  /** Sider i rekkefølge → én jobb for listen; originaler lagres; deretter ÉN lesing. Guard sjekkes før hvert steg. */
  uploadAndRead(i: { opId: string; listId: string; files: File[]; guard: Guard }): Promise<{ jobId: string; duplicate: boolean; status: string }>;
  jobStatus(jobId: string): Promise<{ status: OcrJobStatus; leaseExpired: boolean; resumable: boolean; pagesDone: number; pageCount: number | null; attempts: number; detail: string | null }>;
  /** Godkjenner bekrefter etter ukjent utfall. resume=true: lagrede sider beholdes, bare gjenstående kan leses. */
  resetUnknown(i: { opId: string; jobId: string }): Promise<{ resume: boolean }>;
  /** Eksplisitt fortsettelse av en frigitt/bekreftet jobb (ingen automatisk ny lesing ved ukjent utfall). */
  resumeRead(i: { jobId: string; guard: Guard }): Promise<{ status: string }>;
  originalUrls(job: VtOcrJob): Promise<(string | null)[]>;
  accept(i: { opId: string; proposalId: string; lineId: string; expectedRevision: number; state: LineState; countedBase: number | null; entry: EntryInput[]; note: string | null; exclusions: { label: string; reason: string }[] }): Promise<SaveLineResult>;
  reject(i: { opId: string; proposalId: string; note: string | null }): Promise<void>;
  previewReport(countId: string): Promise<ReportPreview>;
  /** Sender eller fullfører en RESERVERT sending med lagrede vedlegg. Finnes op-en, sendes aldri noe nytt. */
  sendReport(i: { opId: string; countId: string; hash: string; recipient: string; subject: string; message: string }): Promise<{ state: MailState; detail: string | null; replayed: boolean }>;
  /** Skrivebeskyttet. */
  mailStatus(opId: string): Promise<MailStatus>;
  listAssignments(entity: string): Promise<VtAssignment[]>;
  assign(i: { opId: string; listId: string; userId: string; role: "teller" | "kontrollor"; remove: boolean }): Promise<void>;
  listUnits(entity: string): Promise<VtUnit[]>;
  /** Utsteder (idempotent) sideinndelingen som trykkes. Lesing valideres mot dette. */
  issueManifest(i: { listId: string; layoutVersion: number; pages: string[][] }): Promise<{ manifestId: string; replayed: boolean }>;
  listClarifications(entity: string, countId: string): Promise<VtClarification[]>;
  clarifyPrice(i: { opId: string; lineId: string; expectedClarification: string | null; price: number; sourceKind: ClarSource; sourceRef: string | null; reason: string }): Promise<{ clarificationId: string }>;
  /** Godkjenner: firmaets brukere med skrivetilgang (navn fra eksisterende rm_user_names). */
  listAssignableUsers(entity: string): Promise<VtUser[]>;
}
const CLAR_KINDS = ["faktura", "leverandorpris", "prisliste", "manuell_vurdering"] as const;
export function parseClarification(v: unknown): VtClarification {
  const r = rec(v, "avklaring"); const k = CLAR_KINDS.find(x => x === r.source_kind); if (!k) throw new Error("kilde");
  return { id: s(r.id, "id"), line_id: s(r.line_id, "line"), price_per_base: n(r.price_per_base, "pris"), source_kind: k, source_ref: sN(r.source_ref, "ref"),
    reason: s(r.reason, "reason"), decided_at: s(r.decided_at, "at"), superseded_at: sN(r.superseded_at, "sup") };
}
export const Stage3Context = createContext<Stage3Api | null>(null);
/** Null når inngangen ikke har trinn 3 (da vises funksjonene som ikke tilgjengelige). */
export function useStage3Api(): Stage3Api | null { return useContext(Stage3Context); }

// ---------- parsere ----------
const JOB_ST = ["opprettet", "behandler", "ukjent_ai_utfall", "klar", "feilet"] as const;
const MAIL_ST = ["akseptert_av_tjenesten", "avvist", "ukjent", "reservert", "sender"] as const;
const s = (v: unknown, k: string) => { if (typeof v !== "string") throw new Error(k); return v; };
const sN = (v: unknown, k: string) => (v == null ? null : s(v, k));
const n = (v: unknown, k: string) => { const x = typeof v === "string" ? Number(v) : v; if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(k); return x; };
const b = (v: unknown, k: string) => { if (typeof v !== "boolean") throw new Error(k); return v; };
const mailState = (v: unknown): MailState => { const x = MAIL_ST.find(m => m === v); if (!x) throw new VtUnknownOutcomeError(); return x; };
const parseOriginal = (v: unknown): VtOriginal => { const r = rec(v, "original"); return { path: s(r.path, "path"), sha256: s(r.sha256, "sha"), size: n(r.size, "size"), mime: s(r.mime, "mime"), role: r.role === "original" ? "original" : "side", original_index: r.original_index == null ? null : n(r.original_index, "oi") }; };
export function parsePageSource(v: unknown): VtPageSource {
  const r = rec(v, "kilde"); const fi = n(r.file_index, "fi"); const fp = n(r.file_page, "fp");
  if (!Number.isInteger(fi) || fi < 0 || !Number.isInteger(fp) || fp < 1) throw new Error("kilde");
  return { file_index: fi, file_page: fp, original_index: r.original_index == null ? null : n(r.original_index, "oi") };
}
export function parseJob(v: unknown): VtOcrJob {
  const r = rec(v, "jobb"); const status = JOB_ST.find(x => x === r.status); if (!status) throw new Error("status");
  if (!Array.isArray(r.originals) || !Array.isArray(r.issues)) throw new Error("jobb");
  return { id: s(r.id, "id"), count_list_id: s(r.count_list_id, "list"), status, document_ok: r.document_ok == null ? null : b(r.document_ok, "ok"),
    issues: r.issues.map(x => s(x, "issue")), detail: sN(r.detail, "detail"), created_at: s(r.created_at, "ca"), originals: r.originals.map(parseOriginal),
    attempts: n(r.attempts, "attempts"), lease_until: sN(r.lease_until, "lease"), page_count: r.page_count == null ? null : n(r.page_count, "pc"),
    page_sources: Array.isArray(r.page_sources) ? r.page_sources.map(parsePageSource) : [] };
}
export function parseProposal(v: unknown): VtOcrProposal {
  const r = rec(v, "forslag"); if (!Array.isArray(r.entries)) throw new Error("entries");
  const entries = r.entries.map((e): ProposalEntry => { const x = rec(e, "felt");
    return { unit_id: sN(x.unit_id, "u"), unit_known: b(x.unit_known, "uk"), label: s(x.label, "l"), value: x.value == null ? null : n(x.value, "v"), reason: sN(x.reason, "r"), raw: sN(x.raw, "raw") }; });
  const st = r.status; if (st !== "foreslatt" && st !== "godkjent" && st !== "avvist") throw new Error("status");
  return { id: s(r.id, "id"), job_id: s(r.job_id, "job"), line_id: s(r.line_id, "line"), line_revision_at_job: n(r.line_revision_at_job, "rev"), page: n(r.page, "page"),
    row_code: s(r.row_code, "rc"), upload_index: r.upload_index == null ? null : n(r.upload_index, "ui"), source: r.source == null ? null : parsePageSource(r.source), entries, reasons: Array.isArray(r.reasons) ? r.reasons.map(x => s(x, "reason")) : [], status: st };
}
function parseSummary(v: unknown): VtSummary {
  const t = rec(v, "totals");
  return { lines: n(t.lines, "l"), counted: n(t.counted, "c"), zero: n(t.zero, "z"), notHere: n(t.notHere, "nh"), notCounted: n(t.notCounted, "nc"), review: n(t.review, "r"),
    value: t.value == null ? null : n(t.value, "v"), countedWithoutPrice: n(t.countedWithoutPrice, "cwp"), complete: b(t.complete, "complete") };
}

// ---------- filer ----------
function readBytes(f: Blob): Promise<ArrayBuffer> {
  if (typeof f.arrayBuffer === "function") return f.arrayBuffer();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => (r.result instanceof ArrayBuffer ? res(r.result) : rej(new Error("fil"))); r.onerror = () => rej(new Error("fil")); r.readAsArrayBuffer(f); });
}
export async function sha256Blob(f: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await readBytes(f));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const OCR_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
export const OCR_MAX_FILES = 20;
export function checkUploadFiles(fs: File[]): string | null {
  if (fs.length === 0) return "Velg minst én fil.";
  if (fs.length > OCR_MAX_FILES) return `Maks ${OCR_MAX_FILES} filer per liste.`;
  for (const f of fs) {
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.type)) return `«${f.name}»: bare PDF eller bilde (JPG, PNG, WEBP).`;
    if (f.size <= 0 || f.size > 20 * 1024 * 1024) return `«${f.name}» må være mindre enn 20 MB.`;
  }
  return null;
}
/**
 * WEBP gjøres om til PNG i nettleseren (serveren kan sette inn JPEG/PNG direkte). Den normaliserte filen er det som
 * lagres, leses og vises ved kontroll. Dette er en dokumentert begrensning: WEBP-originalen lagres ikke separat.
 */
async function normalize(f: File): Promise<File> {
  if (f.type !== "image/webp") return f;
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bilde")); i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d"); if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob(x => (x ? res(x) : rej(new Error("png"))), "image/png"));
    return new File([blob], f.name.replace(/\.webp$/i, ".png"), { type: "image/png" });
  } finally { URL.revokeObjectURL(url); }
}

// ---------- Supabase ----------
const db: SupabaseClient = supabase;
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  let r: { data: unknown; error: { code?: string; message?: string } | null };
  try { r = await db.rpc(name, args); } catch { throw new VtUnknownOutcomeError(); }
  if (r.error) throw rejectOrUnknown(r.error);
  return r.data;
}
/** Fullstendig henting: eksakt antall + keyset på id, antall kontrolleres på nytt (ingen stille avkutting ved 1000). */
async function readAllRows<T>(table: string, cols: string, filters: [string, string][], parse: (v: unknown) => T, join = ""): Promise<T[]> {
  const sel = join ? `${cols}, ${join}` : cols;
  try {
    const rows = await fetchAllCounted<{ id: string; raw: unknown }>({
      count: () => { let q = db.from(table).select(join ? `id, ${join}` : "id", { count: "exact", head: true }); for (const [k, v] of filters) q = q.eq(k, v); return q; },
      page: (after, size) => {
        let q = db.from(table).select(sel); for (const [k, v] of filters) q = q.eq(k, v);
        if (after) q = q.gt("id", after);
        return q.order("id").limit(size).then(r => ({ data: Array.isArray(r.data) ? r.data.map(x => { const o = rec(x, "rad"); return { id: s(o.id, "id"), raw: o }; }) : null, error: r.error }));
      },
    });
    return rows.map(r => parse(r.raw));
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && MISSING.has(String((e as { code: unknown }).code))) throw new VtBackendUnavailableError();
    throw new Error("Kunne ikke hente alle rader.");
  }
}
async function invoke(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let r: { data: unknown; error: unknown };
  try { r = await db.functions.invoke(fn, { body }); } catch { throw new VtUnknownOutcomeError(); }
  if (r.error) {
    const ctx = (r.error as { context?: Response }).context; const status = ctx?.status ?? null;
    if (status === 404) throw new VtBackendUnavailableError();
    let msg: string | null = null;
    try { const j: unknown = await ctx?.json(); msg = typeof j === "object" && j !== null && typeof (j as { error?: unknown }).error === "string" ? (j as { error: string }).error : null; } catch { msg = null; }
    if (status && status >= 400 && status < 500) throw new VtRejectedError(msg ?? "Forespørselen ble avvist.", String(status));
    if (status === 503) throw new VtRejectedError(msg ?? "Tjenesten er ikke konfigurert.", "503");
    throw new VtUnknownOutcomeError();
  }
  return rec(r.data, "svar");
}
const JOB = "id, count_list_id, status, document_ok, issues, detail, created_at, originals, attempts, lease_until, page_count, page_sources";
const PROP = "id, job_id, line_id, line_revision_at_job, page, row_code, upload_index, source, entries, reasons, status";
const step = (g: Guard) => { if (!g()) throw new VtStaleContextError(); };

export const supabaseStage3Api: Stage3Api = {
  async probe() {
    const r = await db.rpc("vt_stage3_version");
    if (r.error) { if (r.error.code && MISSING.has(r.error.code)) return "missing"; throw new Error("Kunne ikke kontrollere."); }
    const v = typeof r.data === "object" && r.data !== null ? (r.data as { stage3?: unknown }).stage3 : null;
    return v === 2 ? "ok" : "missing";
  },
  listJobs: (e, listId) => readAllRows("vt_ocr_jobs", JOB, [["legal_entity_id", e], ["count_list_id", listId]], parseJob).then(js => js.sort((a, z) => z.created_at.localeCompare(a.created_at))),
  listProposals: (e, jobId) => readAllRows("vt_ocr_proposals", PROP, [["legal_entity_id", e], ["job_id", jobId]], parseProposal).then(ps => ps.sort((a, z) => a.page - z.page || a.row_code.localeCompare(z.row_code))),
  async uploadAndRead({ opId, listId, files, guard }) {
    const bad = checkUploadFiles(files); if (bad) throw new VtRejectedError(bad, "22023");
    step(guard);
    // WEBP: original bevares som egen fil (rolle «original»), PNG-avledning er siden som leses (rolle «side»).
    const norm: File[] = []; const meta: { sha256: string; size: number; mime: string; role: "side" | "original"; original_index?: number }[] = [];
    for (const f of files) {
      if (f.type === "image/webp") {
        const idx = meta.length; norm.push(f); meta.push({ sha256: await sha256Blob(f), size: f.size, mime: f.type, role: "original" }); step(guard);
        const d = await normalize(f); step(guard); norm.push(d); meta.push({ sha256: await sha256Blob(d), size: d.size, mime: d.type, role: "side", original_index: idx });
      } else { norm.push(f); meta.push({ sha256: await sha256Blob(f), size: f.size, mime: f.type, role: "side" }); }
      step(guard);
    }
    const res = rec(await rpc("vt_ocr_create_job", { p_op_id: opId, p_list_id: listId, p_files: meta }), "jobb");
    const jobId = s(res.job_id, "job_id"); const duplicate = res.duplicate === true; const status = s(res.status, "status");
    if (!Array.isArray(res.originals)) throw new VtUnknownOutcomeError();
    const originals = res.originals.map(parseOriginal);
    if (status !== "opprettet") return { jobId, duplicate, status };
    const bucket = db.storage.from("vt-count-uploads");
    for (let i = 0; i < norm.length; i++) {
      step(guard);
      const o = originals[i]; if (!o || o.sha256 !== meta[i].sha256) throw new VtUnknownOutcomeError();
      const up = await bucket.upload(o.path, norm[i], { upsert: false, contentType: norm[i].type });
      if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new VtUnknownOutcomeError();
    }
    step(guard);
    let r = await invoke("vt-count-ocr", { job_id: jobId });
    // Gjenopptakbar lesing: høyst 3 sider per kall; fortsett samme forsøk til ferdig (avgrenset antall kall).
    for (let k = 0; k < 10 && r.status === "fortsetter"; k++) { step(guard); r = await invoke("vt-count-ocr", { job_id: jobId, continue: true }); }
    return { jobId, duplicate, status: typeof r.status === "string" ? r.status : "ukjent" };
  },
  async jobStatus(jobId) {
    const r = rec(await rpc("vt_ocr_job_status", { p_job_id: jobId }), "status");
    const status = JOB_ST.find(x => x === r.status); if (!status) throw new VtUnknownOutcomeError();
    return { status, leaseExpired: r.lease_expired === true, resumable: r.resumable === true, pagesDone: r.pages_done == null ? 0 : n(r.pages_done, "pd"),
      pageCount: r.page_count == null ? null : n(r.page_count, "pc"), attempts: n(r.attempts, "a"), detail: sN(r.detail, "d") };
  },
  resetUnknown: (i) => rpc("vt_ocr_reset_unknown", { p_op_id: i.opId, p_job_id: i.jobId, p_confirm_paid_rerun: true }).then(d => {
    const r = rec(d, "svar"); if (r.job_id !== i.jobId || typeof r.resume !== "boolean") throw new VtUnknownOutcomeError(); return { resume: r.resume };
  }),
  async resumeRead({ jobId, guard }) {
    step(guard);
    let r = await invoke("vt-count-ocr", { job_id: jobId, continue: true });
    // Bare videre så lenge serveren svarer «fortsetter» (forrige del varig frigitt). Ukjent utfall stopper.
    for (let k = 0; k < 10 && r.status === "fortsetter"; k++) { step(guard); r = await invoke("vt-count-ocr", { job_id: jobId, continue: true }); }
    return { status: typeof r.status === "string" ? r.status : "ukjent" };
  },
  async originalUrls(job) {
    const out: (string | null)[] = [];
    for (const o of job.originals) { const r = await db.storage.from("vt-count-uploads").createSignedUrl(o.path, 600); out.push(r.error ? null : r.data.signedUrl); }
    return out;
  },
  accept: (i) => rpc("vt_ocr_accept", { p_op_id: i.opId, p_proposal_id: i.proposalId, p_expected_revision: i.expectedRevision, p_state: i.state, p_counted_base: i.countedBase,
    p_entry: i.entry, p_note: i.note, p_exclusions: i.exclusions }).then(d => {
    if (rec(d, "svar").proposal_id !== i.proposalId) throw new VtUnknownOutcomeError();
    try { return parseSaveLine(d, i.lineId, i.expectedRevision); } catch { throw new VtUnknownOutcomeError(); }
  }),
  reject: (i) => rpc("vt_ocr_reject", { p_op_id: i.opId, p_proposal_id: i.proposalId, p_note: i.note }).then(d => { if (rec(d, "svar").proposal_id !== i.proposalId) throw new VtUnknownOutcomeError(); }),
  async previewReport(countId) {
    const r = await invoke("vt-count-report-email", { action: "preview", count_id: countId });
    return { hash: s(r.hash, "hash"), countRevision: n(r.count_revision, "rev"), final: b(r.final, "final"), defaultSubject: s(r.default_subject, "subj"),
      attachmentBase: s(r.attachment_base, "base"), csv: s(r.csv, "csv"), pdfB64: s(r.pdf_b64, "pdf"), totals: parseSummary(r.totals), mailConfigured: r.mail_configured === true, sender: r.mail_configured === true ? s(r.sender, "sender") : null };
  },
  async sendReport(i) {
    const r = await invoke("vt-count-report-email", { action: "send", op_id: i.opId, count_id: i.countId, hash: i.hash, recipient: i.recipient, subject: i.subject, message: i.message });
    return { state: mailState(r.state), detail: sN(r.detail, "detail"), replayed: r.replayed === true };
  },
  async mailStatus(opId) {
    const r = await invoke("vt-count-report-email", { action: "status", op_id: opId });
    return r.found === true ? { found: true, state: mailState(r.state), detail: sN(r.detail, "d") } : { found: false, state: null, detail: null };
  },
  listAssignments: (e) => readAllRows("vt_list_assignments", "id, count_list_id, user_id, role", [["legal_entity_id", e]], v => {
    const r = rec(v, "tildeling"); const role = r.role === "kontrollor" ? "kontrollor" : r.role === "teller" ? "teller" : null; if (!role) throw new Error("role");
    return { id: s(r.id, "id"), count_list_id: s(r.count_list_id, "l"), user_id: s(r.user_id, "u"), role };
  }),
  assign: (i) => rpc("vt_assign_list", { p_op_id: i.opId, p_list_id: i.listId, p_user_id: i.userId, p_role: i.role, p_remove: i.remove }).then(d => { if (rec(d, "svar").list_id !== i.listId) throw new VtUnknownOutcomeError(); }),
  issueManifest: (i) => rpc("vt_issue_print_manifest", { p_list_id: i.listId, p_layout_version: i.layoutVersion, p_pages: i.pages }).then(d => {
    const r = rec(d, "manifest"); return { manifestId: s(r.manifest_id, "id"), replayed: r.replayed === true };
  }),
  listClarifications: (e, countId) => readAllRows("vt_price_clarifications", "id, line_id, price_per_base, source_kind, source_ref, reason, decided_at, superseded_at",
    [["legal_entity_id", e], ["count_id", countId]], parseClarification),
  clarifyPrice: (i) => rpc("vt_clarify_price", { p_op_id: i.opId, p_line_id: i.lineId, p_expected_clarification: i.expectedClarification, p_price: i.price,
    p_source_kind: i.sourceKind, p_source_ref: i.sourceRef, p_reason: i.reason }).then(d => {
    const r = rec(d, "svar"); if (r.line_id !== i.lineId) throw new VtUnknownOutcomeError(); return { clarificationId: s(r.clarification_id, "id") };
  }),
  async listAssignableUsers(e) {
    const ids = await rpc("vt_assignable_users", { p_legal_entity_id: e });
    if (!Array.isArray(ids)) throw new Error("Kunne ikke hente brukere.");
    const list = ids.map(x => s(rec(x, "bruker").user_id, "id"));
    if (list.length === 0) return [];
    // rm_user_names tar høyst 500 ID-er per kall (live-definisjon) ⇒ hent i biter; ugyldig svar er feil, ikke «uten navn».
    const byId = new Map<string, string>();
    for (let i = 0; i < list.length; i += 500) {
      const names = await rpc("rm_user_names", { p_legal_entity_id: e, p_user_ids: list.slice(i, i + 500) });
      if (!Array.isArray(names)) throw new Error("Kunne ikke hente navn.");
      for (const x of names) { const r = rec(x, "navn"); if (typeof r.name === "string" && r.name.trim()) byId.set(s(r.id, "id"), r.name); }
    }
    return list.map(id => ({ id, name: byId.get(id) ?? "Navn mangler" })).sort((a, z) => a.name.localeCompare(z.name, "nb"));
  },
  listUnits: (e) => readAllRows("raw_material_units", "id, raw_material_id, unit_label, units_in_base", [["raw_materials.legal_entity_id", e]], v => {
    const r = rec(v, "enhet"); return { id: s(r.id, "id"), raw_material_id: s(r.raw_material_id, "rm"), label: s(r.unit_label, "label"), units_in_base: n(r.units_in_base, "uib") };
  }, "raw_materials!inner(legal_entity_id)"),
};

// ---------- Syntetisk (forhåndsvisning/tester) — ingen nettverk, IKKE ekte AI ----------
type FakeBase = VtApi & { _state: import("./fakeApi").FakeState };
export interface FakeStage3Opts { available?: boolean; mailConfigured?: boolean; mailOutcome?: MailState | "tapt_svar"; readOutcome?: "ok" | "ukjent" }
export function createFakeStage3(base: FakeBase, opts: FakeStage3Opts = {}) {
  const st = base._state; let seq = 0;
  const jobs: VtOcrJob[] = []; const props: VtOcrProposal[] = []; const keys = new Map<string, string>(); const urls = new Map<string, string[]>();
  const mail = new Map<string, { sig: string; state: MailState; csv: string }>(); const assign: VtAssignment[] = []; const ops = new Map<string, unknown>();
  const counters = { graphCalls: 0, aiReads: 0 };
  const manifests = new Map<string, string[][]>(); const clars: VtClarification[] = [];
  const unavailable = () => { if (opts.available === false) throw new VtBackendUnavailableError(); };
  const data = (countId: string): VtReportData => {
    const c = st.counts.find(x => x.id === countId); if (!c || c.status === "planlagt") throw new VtRejectedError("Tellingen er ikke startet", "55000");
    const lines = st.lines.filter(l => l.count_id === countId);
    const ver = lines.reduce((m, l) => (l.updated_at > m ? l.updated_at : m), c.started_at ?? "");
    return { count: c, lists: st.lists.filter(l => l.count_id === countId).sort((a, z) => a.sort_order - z.sort_order), lines, generatedAt: `data per ${ver} (rev ${c.revision})` };
  };
  /** Syntetisk «lest» side: tall, tvetydig, tomt, overstrøket, ukjent pakning. Leser bare trykte koder. */
  const syntheticRead = (listId: string, order: number[]): OcrDoc => {
    const list = st.lists.find(l => l.id === listId); if (!list) return { pages: [] };
    const lines = st.lines.filter(l => l.count_list_id === listId).sort((a, z) => a.sort_order - z.sort_order);
    const issued = manifests.get(listId);
    const m = issued ? issued.map((p, i) => ({ page: i + 1, pages: issued.length, identity: `VT2|${list.count_id}|${list.id}|r${list.source_template_revision}|s${i + 1}/${issued.length}`, lines: p.map(id => lines.find(l => l.id === id)).filter((l): l is (typeof lines)[number] => !!l) }))
      : buildManifest(list.count_id, list.id, list.source_template_revision, lines);
    const raws = ["2", "1.500", null, "3,5", "x?"];
    return { pages: order.map(n => m[n - 1]).filter((p): p is (typeof m)[number] => !!p).map(p => ({ printed_identity: p.identity, complete: true, rows: p.lines.map((l, i) => ({
      row_code: rowCodeOf(l.id), crossed_out: i === 3, unclear: false, comment: null,
      amounts: l.snap_units.length
        ? [{ column: "pakninger" as const, unit_label: i === 0 ? l.snap_units[0].label : "kasse", raw: raws[i % raws.length] }, { column: "los" as const, unit_label: null, raw: i === 0 ? "1.500" : null }]
        : [{ column: "los" as const, unit_label: null, raw: raws[i % raws.length] }],
    })) })) };
  };
  const preview = async (countId: string): Promise<ReportPreview> => {
    const d = data(countId); const csv = buildReportCsv(d);
    const hash = await sha256Blob(new Blob([csv]));
    return { hash, countRevision: d.count.revision, final: d.count.status === "avsluttet", defaultSubject: `Tellerapport: ${d.count.name}`, attachmentBase: `varetelling-${d.count.planned_date}-r${d.count.revision}`,
      csv, pdfB64: "", totals: summarizeLines(d.lines), mailConfigured: opts.mailConfigured === true, sender: opts.mailConfigured === true ? "telling@demo.invalid" : null };
  };
  const api: Stage3Api = {
    async probe() { return opts.available === false ? "missing" : "ok"; },
    async listJobs(_e, listId) { unavailable(); return jobs.filter(j => j.count_list_id === listId).map(j => ({ ...j, issues: [...j.issues], originals: [...j.originals] })); },
    async listProposals(_e, jobId) { unavailable(); return props.filter(p => p.job_id === jobId).map(p => ({ ...p, entries: p.entries.map(e => ({ ...e })) })); },
    async uploadAndRead({ opId, listId, files, guard }) {
      unavailable(); const bad = checkUploadFiles(files); if (bad) throw new VtRejectedError(bad, "22023");
      step(guard);
      if (ops.has(opId)) return ops.get(opId) as { jobId: string; duplicate: boolean; status: string };
      const list = st.lists.find(l => l.id === listId); const c = st.counts.find(x => x.id === list?.count_id);
      if (!list || !c || !["pagar", "til_kontroll"].includes(c.status) || list.status === "godkjent") throw new VtRejectedError("Listen er ikke åpen for registrering", "55000");
      const shas: string[] = []; for (const f of files) { shas.push(`${await sha256Blob(f)}:${f.size}`); step(guard); }
      const k = `${listId}|${shas.join("|")}`;
      const existing = keys.get(k);
      if (existing) { const r = { jobId: existing, duplicate: true, status: jobs.find(j => j.id === existing)?.status ?? "klar" }; ops.set(opId, r); return r; }
      const lines = st.lines.filter(l => l.count_list_id === listId).sort((a, z) => a.sort_order - z.sort_order);
      const jobId = `job-${++seq}`; keys.set(k, jobId);
      urls.set(jobId, files.map(f => (typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : "")));
      const job: VtOcrJob = { id: jobId, count_list_id: listId, status: "behandler", document_ok: null, issues: [], detail: null, created_at: new Date().toISOString(),
        originals: files.map((f, i) => ({ path: `demo/${jobId}/side-${i + 1}`, sha256: shas[i].split(":")[0], size: f.size, mime: f.type, role: "side" as const, original_index: null })), attempts: 1, lease_until: null, page_count: files.length,
        page_sources: files.map((_, i) => ({ file_index: i, file_page: 1, original_index: null })) };
      jobs.unshift(job);
      counters.aiReads++;
      if (opts.readOutcome === "ukjent") { job.status = "ukjent_ai_utfall"; job.detail = "Syntetisk: AI-kall fikk ukjent utfall"; }
      else {
        const r = matchDocument(syntheticRead(listId, files.map((_, i) => i + 1)), buildManifest(list.count_id, list.id, list.source_template_revision, lines));
        job.status = "klar"; job.document_ok = r.document_ok; job.issues = r.issues;
        r.proposals.forEach((p, i) => props.push({ ...p, id: `${jobId}-p${i}`, job_id: jobId, status: "foreslatt", source: job.page_sources[p.upload_index] ?? null }));
      }
      const res = { jobId, duplicate: false, status: job.status }; ops.set(opId, res); return res;
    },
    async jobStatus(jobId) { const j = jobs.find(x => x.id === jobId); if (!j) throw new VtRejectedError("Mangler tilgang", "42501"); return { status: j.status, leaseExpired: false, resumable: false, pagesDone: 0, pageCount: j.page_count, attempts: j.attempts, detail: j.detail }; },
    async resetUnknown({ jobId }) { const j = jobs.find(x => x.id === jobId); if (!j || j.status !== "ukjent_ai_utfall") throw new VtRejectedError("Jobben har ikke ukjent utfall", "55000"); j.status = "opprettet"; return { resume: false }; },
    async resumeRead({ jobId }) { const j = jobs.find(x => x.id === jobId); if (!j || j.status !== "behandler") throw new VtRejectedError("Jobben kan ikke fortsettes", "55000"); return { status: j.status }; },
    async originalUrls(job) { return (urls.get(job.id) ?? []).map(u => u || null); },
    async accept(i) {
      unavailable();
      if (ops.has(i.opId)) return ops.get(i.opId) as SaveLineResult;
      const p = props.find(x => x.id === i.proposalId); const job = jobs.find(j => j.id === p?.job_id); const line = st.lines.find(l => l.id === p?.line_id);
      if (!p || !job || !line || line.id !== i.lineId || line.count_list_id !== job.count_list_id) throw new VtRejectedError("Linjen hører ikke til listen", "42501");
      if (job.status !== "klar" || job.document_ok !== true) throw new VtRejectedError("Dokumentets identitet er ikke bekreftet", "55000");
      if (p.status !== "foreslatt") throw new VtRejectedError("Forslaget er allerede avgjort", "55000");
      if (i.exclusions.some(x => x.reason.trim().length < 3)) throw new VtRejectedError("Utelatt felt må begrunnes", "22023");
      if (i.expectedRevision !== p.line_revision_at_job || line.revision !== p.line_revision_at_job) throw new VtRejectedError("Linjen er endret etter opplasting — kontroller manuelt", "40001");
      const res = await base.saveLine({ opId: `${i.opId}:ocr-save`, lineId: i.lineId, expectedRevision: i.expectedRevision, state: i.state, countedBase: i.countedBase, entry: i.entry, note: i.note });
      if (res.kind !== "saved") throw new VtRejectedError("Linjen kunne ikke lagres", "40001");
      p.status = "godkjent"; ops.set(i.opId, res); return res;
    },
    async reject(i) {
      unavailable(); if (ops.has(i.opId)) return;
      const p = props.find(x => x.id === i.proposalId); if (!p || p.status !== "foreslatt") throw new VtRejectedError("Forslaget er allerede avgjort", "55000");
      p.status = "avvist"; ops.set(i.opId, true);
    },
    previewReport: (countId) => { unavailable(); return preview(countId); },
    async sendReport(i) {
      unavailable();
      const prev = mail.get(i.opId);
      if (prev) {
        if (prev.state !== "reservert") return { state: prev.state, detail: null, replayed: true };
        counters.graphCalls++; prev.state = "akseptert_av_tjenesten"; return { state: prev.state, detail: null, replayed: false };
      }
      if (opts.mailConfigured !== true) throw new VtRejectedError("Microsoft 365-avsender er ikke koblet til.", "503");
      const cur = await preview(i.countId);
      if (cur.hash !== i.hash) throw new VtRejectedError("Rapporten er endret siden forhåndsvisningen. Åpne forhåndsvisningen på nytt.", "409");
      const sig = JSON.stringify([i.countId, i.hash, i.recipient.trim(), i.subject.trim(), i.message]);
      const outcome = opts.mailOutcome ?? "akseptert_av_tjenesten";
      if (outcome === "reservert") { mail.set(i.opId, { sig, state: "reservert", csv: cur.csv }); throw new VtUnknownOutcomeError(); }
      counters.graphCalls++;
      if (outcome === "tapt_svar") { mail.set(i.opId, { sig, state: "ukjent", csv: cur.csv }); throw new VtUnknownOutcomeError(); }
      mail.set(i.opId, { sig, state: outcome, csv: cur.csv });
      return { state: outcome, detail: outcome === "ukjent" ? "Nettverksfeil eller tidsavbrudd" : null, replayed: false };
    },
    async mailStatus(opId) { unavailable(); const m = mail.get(opId); return m ? { found: true, state: m.state, detail: null } : { found: false, state: null, detail: null }; },
    async listAssignments() { unavailable(); return assign.map(a => ({ ...a })); },
    async assign(i) {
      unavailable();
      const list = st.lists.find(l => l.id === i.listId); const c = st.counts.find(x => x.id === list?.count_id);
      if (!c || !["planlagt", "pagar", "til_kontroll"].includes(c.status)) throw new VtRejectedError("Tellingen er avsluttet — tildeling endres ikke", "55000");
      const at = assign.findIndex(a => a.count_list_id === i.listId && a.user_id === i.userId && a.role === i.role);
      if (i.remove) { if (at >= 0) assign.splice(at, 1); } else if (at < 0) assign.push({ id: `as-${++seq}`, count_list_id: i.listId, user_id: i.userId, role: i.role });
    },
    async issueManifest({ listId, pages }) {
      unavailable(); const cur = manifests.get(listId);
      const all = st.lines.filter(l => l.count_list_id === listId).map(l => l.id).sort(); const flat = pages.flat();
      if (flat.length !== all.length || [...flat].sort().join() !== all.join()) throw new VtRejectedError("Sideinndelingen må inneholde hver linje i listen nøyaktig én gang", "22023");
      if (cur) { if (JSON.stringify(cur) !== JSON.stringify(pages)) throw new VtRejectedError("Utstedt sideinndeling er annerledes", "23505"); return { manifestId: `m-${listId}`, replayed: true }; }
      manifests.set(listId, pages.map(p => [...p])); return { manifestId: `m-${listId}`, replayed: false };
    },
    async listClarifications(_e, countId) { unavailable(); return clars.filter(c => st.lines.find(l => l.id === c.line_id)?.count_id === countId).map(c => ({ ...c })); },
    async clarifyPrice(i) {
      unavailable();
      if (ops.has(i.opId)) return ops.get(i.opId) as { clarificationId: string };
      const line = st.lines.find(l => l.id === i.lineId); const c = st.counts.find(x => x.id === line?.count_id);
      if (!line || !c) throw new VtRejectedError("Mangler tilgang", "42501");
      if (!["pagar", "til_kontroll"].includes(c.status)) throw new VtRejectedError("Tellingen er ikke åpen", "55000");
      if (line.snap_price_per_base != null) throw new VtRejectedError("Linjen har dokumentert pris fra start", "55000");
      if (!Number.isFinite(i.price) || i.price <= 0 || i.price > 1e6 || i.reason.trim().length < 10) throw new VtRejectedError("Pris, kilde og begrunnelse (minst 10 tegn) kreves", "22023");
      const cur = clars.find(x => x.line_id === i.lineId && x.superseded_at == null);
      if ((cur?.id ?? null) !== i.expectedClarification) throw new VtRejectedError("Prisavklaringen er endret av andre", "40001");
      if (cur) cur.superseded_at = new Date().toISOString();
      const nw: VtClarification = { id: `clar-${++seq}`, line_id: i.lineId, price_per_base: i.price, source_kind: i.sourceKind, source_ref: i.sourceRef, reason: i.reason.trim(), decided_at: new Date().toISOString(), superseded_at: null };
      clars.push(nw); st.clarified.add(i.lineId);
      const res = { clarificationId: nw.id }; ops.set(i.opId, res); return res;
    },
    async listAssignableUsers() { unavailable(); return [{ id: "u1", name: "Demo Teller" }, { id: "u2", name: "Kari Kontrollør (demo)" }, { id: "u3", name: "Ola Opptelling (demo)" }]; },
    async listUnits() { unavailable(); return [...st.units.entries()].flatMap(([rm, us]) => us.map(u => ({ id: u.id, raw_material_id: rm, label: u.label, units_in_base: u.units_in_base }))); },
  };
  /**
   * Forhåndsvisning: ferdig syntetisk lesejobb (ingen filvelger/nettverk, IKKE ekte AI) med samme kildekobling som
   * serveren: filer i opplastingsrekkefølge, der en «side»-fil kan ha flere trykte sider (PDF) og en avledning kan
   * peke til bevart original. `printed` = trykte sidenumre i filen, i filens siderekkefølge.
   */
  const seedDemo = (listId: string, files: { url: string; mime: string; role: "side" | "original"; original_index?: number; printed?: number[] }[]) => {
    const list = st.lists.find(l => l.id === listId); if (!list) return null;
    const lines = st.lines.filter(l => l.count_list_id === listId).sort((a, z) => a.sort_order - z.sort_order);
    const jobId = `job-demo-${++seq}`; urls.set(jobId, files.map(f => f.url));
    const sources: VtPageSource[] = []; const order: number[] = [];
    files.forEach((f, fi) => { if (f.role === "side") (f.printed ?? []).forEach((pn, k) => { sources.push({ file_index: fi, file_page: k + 1, original_index: f.original_index ?? null }); order.push(pn); }); });
    const doc = syntheticRead(listId, order);
    const issued = manifests.get(listId);
    const man = issued ? issued.map((p, i) => ({ page: i + 1, pages: issued.length, identity: `VT2|${list.count_id}|${list.id}|r${list.source_template_revision}|s${i + 1}/${issued.length}`, lines: p.map(id => lines.find(l => l.id === id)).filter((l): l is (typeof lines)[number] => !!l) }))
      : buildManifest(list.count_id, list.id, list.source_template_revision, lines);
    const r = matchDocument(doc, man);
    jobs.unshift({ id: jobId, count_list_id: listId, status: "klar", document_ok: r.document_ok, issues: r.issues, detail: "Syntetisk demonstrasjon — ikke ekte lesing", created_at: new Date().toISOString(),
      originals: files.map((f, i) => ({ path: `demo/${jobId}/${f.role}-${i + 1}`, sha256: "demo", size: 1, mime: f.mime, role: f.role, original_index: f.original_index ?? null })),
      attempts: 1, lease_until: null, page_count: sources.length, page_sources: sources });
    r.proposals.forEach((p, i) => props.push({ ...p, id: `${jobId}-p${i}`, job_id: jobId, status: "foreslatt", source: sources[p.upload_index] ?? null }));
    return jobId;
  };
  return Object.assign(api, { _jobs: jobs, _props: props, _mail: mail, _assign: assign, _counters: counters, _manifests: manifests, _clars: clars, seedDemo });
}
