import { createContext, useContext } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { rejectOrUnknown, VtBackendUnavailableError, VtRejectedError, VtUnknownOutcomeError, type VtApi } from "./api";
import { parseSaveLine, rec, type EntryInput, type LineState, type SaveLineResult } from "./types";
import { buildManifest, matchDocument, type OcrDoc, type ProposalEntry } from "../../../supabase/pending/functions/vt-count-ocr/ocrCore";
import { buildReportCsv, defaultSubject, reportTotals, sha256Hex, validateMail, type ReportTotals } from "../../../supabase/pending/functions/vt-count-report-email/reportCore";

/**
 * Trinn 3: listebundet opplasting med lese-FORSLAG, rapport-e-post og tildeling.
 * Egen sonde (vt_stage3_version) — uten utrullet SQL/Edge viser UI at funksjonen ikke er tatt i bruk.
 */
export type OcrJobStatus = "opprettet" | "behandler" | "ukjent_ai_utfall" | "klar" | "feilet";
export interface VtOcrJob { id: string; count_list_id: string; status: OcrJobStatus; document_ok: boolean | null; issues: string[]; failure_reason: string | null; created_at: string; mime: string; original_path: string }
export interface VtOcrProposal {
  id: string; job_id: string; line_id: string; line_revision_at_job: number; page: number; row_code: string;
  entries: ProposalEntry[]; reasons: string[]; crop: { x: number; y: number; w: number; h: number } | null;
  status: "foreslatt" | "godkjent" | "avvist"; corrected: boolean | null;
}
export interface ReportPreview { hash: string; countRevision: number; final: boolean; defaultSubject: string; attachments: string[]; totals: ReportTotals; mailConfigured: boolean }
export type MailState = "akseptert_av_tjenesten" | "avvist" | "ukjent" | "reservert" | "sender";
export interface VtAssignment { count_list_id: string; user_id: string; role: "teller" | "kontrollor" }
export interface VtUnit { id: string; raw_material_id: string; label: string; units_in_base: number }

export interface Stage3Api {
  probe(): Promise<"ok" | "missing">;
  listJobs(entity: string, listId: string): Promise<VtOcrJob[]>;
  listProposals(entity: string, jobId: string): Promise<VtOcrProposal[]>;
  /** Hash, ev. PDF-kopi av bilde, opprett jobb, last opp original, start ÉN lesing. */
  uploadAndRead(i: { opId: string; listId: string; file: File }): Promise<{ jobId: string; duplicate: boolean; status: string }>;
  originalUrl(job: VtOcrJob): Promise<string | null>;
  accept(i: { opId: string; proposalId: string; expectedRevision: number; state: LineState; countedBase: number | null; entry: EntryInput[]; note: string | null; lineId: string }): Promise<SaveLineResult>;
  reject(i: { opId: string; proposalId: string; note: string | null }): Promise<void>;
  previewReport(countId: string): Promise<ReportPreview>;
  sendReport(i: { opId: string; countId: string; hash: string; countRevision: number; recipient: string; subject: string; message: string }): Promise<{ state: MailState; detail: string | null; replayed: boolean }>;
  listAssignments(entity: string): Promise<VtAssignment[]>;
  assign(i: { opId: string; listId: string; userId: string; role: "teller" | "kontrollor"; remove: boolean }): Promise<void>;
  listUnits(entity: string): Promise<VtUnit[]>;
}
export const Stage3Context = createContext<Stage3Api | null>(null);
export function useStage3Api(): Stage3Api { const a = useContext(Stage3Context); if (!a) throw new Error("Stage3Context mangler"); return a; }

// ---------- parsere ----------
const JOB_ST = ["opprettet", "behandler", "ukjent_ai_utfall", "klar", "feilet"] as const;
const s = (v: unknown, k: string) => { if (typeof v !== "string") throw new Error(k); return v; };
const sN = (v: unknown, k: string) => (v == null ? null : s(v, k));
const n = (v: unknown, k: string) => { const x = typeof v === "string" ? Number(v) : v; if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(k); return x; };
export function parseJob(v: unknown): VtOcrJob {
  const r = rec(v, "jobb"); const st = s(r.status, "status");
  const status = JOB_ST.find(x => x === st); if (!status) throw new Error("status");
  const issues = Array.isArray(r.issues) ? r.issues.map(x => s(x, "issue")) : [];
  return { id: s(r.id, "id"), count_list_id: s(r.count_list_id, "list"), status, document_ok: typeof r.document_ok === "boolean" ? r.document_ok : null, issues,
    failure_reason: sN(r.failure_reason, "fr"), created_at: s(r.created_at, "ca"), mime: s(r.mime, "mime"), original_path: s(r.original_path, "op") };
}
export function parseProposal(v: unknown): VtOcrProposal {
  const r = rec(v, "forslag");
  if (!Array.isArray(r.entries)) throw new Error("entries");
  const entries = r.entries.map((e): ProposalEntry => { const x = rec(e, "felt");
    return { unit_id: sN(x.unit_id, "u"), label: s(x.label, "l"), value: x.value == null ? null : n(x.value, "v"), reason: sN(x.reason, "r"), raw: sN(x.raw, "raw") }; });
  const crop = r.crop == null ? null : (() => { const c = rec(r.crop, "crop"); return { x: n(c.x, "x"), y: n(c.y, "y"), w: n(c.w, "w"), h: n(c.h, "h") }; })();
  const st = s(r.status, "status"); if (st !== "foreslatt" && st !== "godkjent" && st !== "avvist") throw new Error("status");
  return { id: s(r.id, "id"), job_id: s(r.job_id, "job"), line_id: s(r.line_id, "line"), line_revision_at_job: n(r.line_revision_at_job, "rev"), page: n(r.page, "page"),
    row_code: s(r.row_code, "rc"), entries, reasons: Array.isArray(r.reasons) ? r.reasons.map(x => s(x, "reason")) : [], crop, status: st,
    corrected: typeof r.corrected === "boolean" ? r.corrected : null };
}

async function sha256File(f: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export const OCR_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export function checkUploadFile(f: File): string | null {
  if (!OCR_MIME.some(m => m === f.type)) return "Bare PDF eller bilde (JPG, PNG, WEBP).";
  if (f.size <= 0 || f.size > 20 * 1024 * 1024) return "Filen må være mindre enn 20 MB.";
  return null;
}
async function imageToPdf(f: File): Promise<Blob> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bilde")); i.src = url; });
    const { jsPDF } = await import("jspdf");
    const portrait = img.height >= img.width;
    const doc = new jsPDF({ orientation: portrait ? "p" : "l", unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const k = Math.min(W / img.width, H / img.height);
    doc.addImage(img, f.type === "image/png" ? "PNG" : "JPEG", (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
    return doc.output("blob");
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
async function readRows<T>(q: PromiseLike<{ data: unknown; error: { code?: string } | null; count: number | null }>, parse: (v: unknown) => T): Promise<T[]> {
  const r = await q;
  if (r.error) throw r.error.code && MISSING.has(r.error.code) ? new VtBackendUnavailableError() : new Error("Kunne ikke hente data.");
  if (!Array.isArray(r.data) || r.count == null || r.count !== r.data.length) throw new Error("Ufullstendig henting.");
  return r.data.map(parse);
}
async function invoke(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let r: { data: unknown; error: unknown };
  try { r = await db.functions.invoke(fn, { body }); } catch { throw new VtUnknownOutcomeError(); }
  if (r.error) {
    const ctx = (r.error as { context?: Response }).context;
    const status = ctx?.status ?? null;
    if (status === 404) throw new VtBackendUnavailableError();
    let msg: string | null = null; try { const j: unknown = await ctx?.json(); msg = typeof j === "object" && j !== null && typeof (j as { error?: unknown }).error === "string" ? (j as { error: string }).error : null; } catch { msg = null; }
    if (status && status >= 400 && status < 500) throw new VtRejectedError(msg ?? "Forespørselen ble avvist.", String(status));
    if (status === 503) throw new VtRejectedError(msg ?? "Tjenesten er ikke konfigurert.", "503");
    throw new VtUnknownOutcomeError();
  }
  return rec(r.data, "svar");
}
const JOB = "id, count_list_id, status, document_ok, issues, failure_reason, created_at, mime, original_path";
const PROP = "id, job_id, line_id, line_revision_at_job, page, row_code, entries, reasons, crop, status, corrected";

export const supabaseStage3Api: Stage3Api = {
  async probe() { const r = await db.rpc("vt_stage3_version"); if (r.error) { if (r.error.code && MISSING.has(r.error.code)) return "missing"; throw new Error("Kunne ikke kontrollere."); } return "ok"; },
  listJobs: (e, listId) => readRows(db.from("vt_ocr_jobs").select(JOB, { count: "exact" }).eq("legal_entity_id", e).eq("count_list_id", listId).order("created_at", { ascending: false }).limit(200), parseJob),
  listProposals: (e, jobId) => readRows(db.from("vt_ocr_proposals").select(PROP, { count: "exact" }).eq("legal_entity_id", e).eq("job_id", jobId).order("page").limit(2000), parseProposal),
  async uploadAndRead({ opId, listId, file }) {
    const bad = checkUploadFile(file); if (bad) throw new VtRejectedError(bad, "22023");
    const sha = await sha256File(file);
    const pdf = file.type === "application/pdf" ? null : await imageToPdf(file);
    const res = rec(await rpc("vt_ocr_create_job", { p_op_id: opId, p_list_id: listId, p_sha256: sha, p_mime: file.type, p_size: file.size, p_has_pdf_derivative: pdf != null }), "jobb");
    const jobId = s(res.job_id, "job_id"); const duplicate = res.duplicate === true; const status = s(res.status, "status");
    if (duplicate) return { jobId, duplicate, status };
    if (status === "opprettet") {
      const bucket = db.storage.from("vt-count-uploads");
      const up = await bucket.upload(s(res.original_path, "op"), file, { upsert: false, contentType: file.type });
      if (up.error && !/exists/i.test(up.error.message)) throw new VtUnknownOutcomeError();
      if (pdf) { const up2 = await bucket.upload(s(res.pdf_path, "pp"), pdf, { upsert: false, contentType: "application/pdf" }); if (up2.error && !/exists/i.test(up2.error.message)) throw new VtUnknownOutcomeError(); }
      const r = await invoke("vt-count-ocr", { job_id: jobId });
      return { jobId, duplicate: false, status: typeof r.status === "string" ? r.status : "ukjent" };
    }
    return { jobId, duplicate: false, status };
  },
  async originalUrl(job) { const r = await db.storage.from("vt-count-uploads").createSignedUrl(job.original_path, 300); return r.error ? null : r.data.signedUrl; },
  accept: (i) => rpc("vt_ocr_accept", { p_op_id: i.opId, p_proposal_id: i.proposalId, p_expected_revision: i.expectedRevision, p_state: i.state, p_counted_base: i.countedBase, p_entry: i.entry, p_note: i.note })
    .then(d => { try { return parseSaveLine(d, i.lineId, i.expectedRevision); } catch { throw new VtUnknownOutcomeError(); } }),
  reject: (i) => rpc("vt_ocr_reject", { p_op_id: i.opId, p_proposal_id: i.proposalId, p_note: i.note }).then(d => { if (rec(d, "svar").proposal_id !== i.proposalId) throw new VtUnknownOutcomeError(); }),
  async previewReport(countId) {
    const r = await invoke("vt-count-report-email", { action: "preview", count_id: countId });
    const t = rec(r.totals, "totals");
    return { hash: s(r.hash, "hash"), countRevision: n(r.count_revision, "rev"), final: r.final === true, defaultSubject: s(r.default_subject, "subj"),
      attachments: Array.isArray(r.attachments) ? r.attachments.map(x => s(x, "att")) : [], mailConfigured: r.mail_configured === true,
      totals: { valued: n(t.valued, "v"), unpricedPositive: n(t.unpricedPositive, "u"), uncounted: n(t.uncounted, "c"), review: n(t.review, "r"), lines: n(t.lines, "l") } };
  },
  async sendReport(i) {
    const bad = validateMail(i); if (bad) throw new VtRejectedError(bad, "22023");
    const r = await invoke("vt-count-report-email", { action: "send", op_id: i.opId, count_id: i.countId, hash: i.hash, count_revision: i.countRevision, recipient: i.recipient, subject: i.subject, message: i.message });
    const st = s(r.state, "state");
    if (!["akseptert_av_tjenesten", "avvist", "ukjent", "reservert", "sender"].includes(st)) throw new VtUnknownOutcomeError();
    return { state: st as MailState, detail: sN(r.detail, "detail"), replayed: r.replayed === true };
  },
  listAssignments: (e) => readRows(db.from("vt_list_assignments").select("count_list_id, user_id, role", { count: "exact" }).eq("legal_entity_id", e).limit(5000), v => {
    const r = rec(v, "tildeling"); const role = r.role === "kontrollor" ? "kontrollor" : r.role === "teller" ? "teller" : null; if (!role) throw new Error("role");
    return { count_list_id: s(r.count_list_id, "l"), user_id: s(r.user_id, "u"), role };
  }),
  assign: (i) => rpc("vt_assign_list", { p_op_id: i.opId, p_list_id: i.listId, p_user_id: i.userId, p_role: i.role, p_remove: i.remove }).then(d => { if (rec(d, "svar").list_id !== i.listId) throw new VtUnknownOutcomeError(); }),
  listUnits: (e) => readRows(db.from("raw_material_units").select("id, raw_material_id, unit_label, units_in_base, raw_materials!inner(legal_entity_id)", { count: "exact" }).eq("raw_materials.legal_entity_id", e).limit(10000), v => {
    const r = rec(v, "enhet"); return { id: s(r.id, "id"), raw_material_id: s(r.raw_material_id, "rm"), label: s(r.unit_label, "label"), units_in_base: n(r.units_in_base, "uib") };
  }),
};

// ---------- Syntetisk (forhåndsvisning/tester) ----------
type FakeBase = VtApi & { _state: import("./fakeApi").FakeState };
export interface FakeStage3Opts { available?: boolean; mailConfigured?: boolean; mailOutcome?: MailState | "tapt_svar"; userId?: string }
export function createFakeStage3(base: FakeBase, opts: FakeStage3Opts = {}): Stage3Api & { _jobs: VtOcrJob[]; _props: VtOcrProposal[]; _mail: Map<string, { sig: string; state: MailState }>; _assign: VtAssignment[] } {
  const st = base._state; let seq = 0;
  const jobs: VtOcrJob[] = []; const props: VtOcrProposal[] = []; const sha = new Map<string, string>(); const mail = new Map<string, { sig: string; state: MailState }>();
  const assign: VtAssignment[] = []; const ops = new Set<string>();
  const unavailable = () => { if (opts.available === false) throw new VtBackendUnavailableError(); };
  /** Syntetisk «lest» dokument: riktig identitet for side 1, tall/tvetydig/overstrøket/tomt. Leser bare trykt kode. */
  const syntheticRead = (listId: string): OcrDoc => {
    const list = st.lists.find(l => l.id === listId); const lines = st.lines.filter(l => l.count_list_id === listId).sort((a, b) => a.sort_order - b.sort_order);
    if (!list) return { pages: [] };
    const m = buildManifest(list.count_id, list.id, list.source_template_revision, lines);
    const raws = ["2", "1.500", null, "3,5", "x?"];
    return { pages: m.map(p => ({ printed_identity: p.identity, printed_page: `${p.page}/${p.pages}`, rows: p.lines.map((l, i) => ({
      row_code: l.id.slice(0, 8), crossed_out: i === 3, unclear: false, comment: null,
      amounts: [{ column: (l.snap_units.length ? "pakninger" : "los") as "pakninger" | "los", unit_label: l.snap_units[0]?.label ?? null, raw: raws[i % raws.length] }],
    })) })) };
  };
  const preview = async (countId: string): Promise<ReportPreview> => {
      unavailable();
      const c = st.counts.find(x => x.id === countId); if (!c || c.status === "planlagt") throw new VtRejectedError("Tellingen er ikke startet", "55000");
      const lists = st.lists.filter(l => l.count_id === countId).sort((a, b) => a.sort_order - b.sort_order);
      const lines = st.lines.filter(l => l.count_id === countId);
      const csv = buildReportCsv(c, lists, lines);
      const base0 = `varetelling-${c.planned_date}-r${c.revision}`;
      return { hash: await sha256Hex(csv), countRevision: c.revision, final: c.status === "avsluttet", defaultSubject: defaultSubject(c), attachments: [`${base0}.csv`, `${base0}.pdf`], totals: reportTotals(lines), mailConfigured: opts.mailConfigured === true };
    };
  return {
    _jobs: jobs, _props: props, _mail: mail, _assign: assign,
    async probe() { return opts.available === false ? "missing" : "ok"; },
    async listJobs(_e, listId) { unavailable(); return jobs.filter(j => j.count_list_id === listId).map(j => ({ ...j, issues: [...j.issues] })); },
    async listProposals(_e, jobId) { unavailable(); return props.filter(p => p.job_id === jobId).map(p => ({ ...p, entries: p.entries.map(e => ({ ...e })) })); },
    async uploadAndRead({ listId, file }) {
      unavailable();
      const bad = checkUploadFile(file); if (bad) throw new VtRejectedError(bad, "22023");
      const list = st.lists.find(l => l.id === listId); const c = st.counts.find(x => x.id === list?.count_id);
      if (!list || !c || !["pagar", "til_kontroll"].includes(c.status) || list.status === "godkjent") throw new VtRejectedError("Listen er ikke åpen for registrering", "55000");
      const h = await sha256File(file); const k = `${listId}|${h}`;
      const existing = sha.get(k); if (existing) return { jobId: existing, duplicate: true, status: jobs.find(j => j.id === existing)?.status ?? "klar" };
      const lines = st.lines.filter(l => l.count_list_id === listId).sort((a, b) => a.sort_order - b.sort_order);
      const jobId = `job-${++seq}`; sha.set(k, jobId);
      const revs = new Map(lines.map(l => [l.id, l.revision]));
      const r = matchDocument(syntheticRead(listId), buildManifest(list.count_id, list.id, list.source_template_revision, lines.map(l => ({ id: l.id, revision: revs.get(l.id) ?? 0, snap_base_unit: l.snap_base_unit, snap_units: l.snap_units }))));
      jobs.unshift({ id: jobId, count_list_id: listId, status: "klar", document_ok: r.document_ok, issues: r.issues, failure_reason: null, created_at: new Date().toISOString(), mime: file.type, original_path: `demo/${jobId}` });
      r.proposals.forEach((p, i) => props.push({ ...p, id: `${jobId}-p${i}`, job_id: jobId, crop: null, status: "foreslatt", corrected: null }));
      return { jobId, duplicate: false, status: "klar" };
    },
    async originalUrl() { return null; },
    async accept(i) {
      unavailable();
      const p = props.find(x => x.id === i.proposalId); const job = jobs.find(j => j.id === p?.job_id);
      const line = st.lines.find(l => l.id === p?.line_id);
      if (ops.has(i.opId)) return base.saveLine({ opId: i.opId, lineId: i.lineId, expectedRevision: i.expectedRevision, state: i.state, countedBase: i.countedBase, entry: i.entry, note: i.note });
      if (!p || !job || !line || line.id !== i.lineId || line.count_list_id !== job.count_list_id) throw new VtRejectedError("Linjen hører ikke til listen", "42501");
      if (job.document_ok !== true) throw new VtRejectedError("Dokumentets identitet er ikke bekreftet", "55000");
      if (p.status !== "foreslatt") throw new VtRejectedError("Forslaget er allerede avgjort", "55000");
      if (i.expectedRevision !== p.line_revision_at_job || line.revision !== p.line_revision_at_job) throw new VtRejectedError("Linjen er endret etter opplasting — kontroller manuelt", "40001");
      ops.add(i.opId);
      const res = await base.saveLine({ opId: i.opId, lineId: i.lineId, expectedRevision: i.expectedRevision, state: i.state, countedBase: i.countedBase, entry: i.entry, note: i.note });
      if (res.kind === "saved") {
        const proposed = p.entries.filter(e => e.value != null).map(e => `${e.unit_id}:${e.value}`).sort().join();
        p.status = "godkjent"; p.corrected = proposed !== i.entry.map(e => `${e.unit_id}:${e.amount}`).sort().join();
      }
      return res;
    },
    async reject(i) { unavailable(); const p = props.find(x => x.id === i.proposalId); if (!p || p.status !== "foreslatt") throw new VtRejectedError("Forslaget er allerede avgjort", "55000"); p.status = "avvist"; },
    previewReport: (countId) => preview(countId),
    async sendReport(i) {
      unavailable();
      const bad = validateMail(i); if (bad) throw new VtRejectedError(bad, "22023");
      if (opts.mailConfigured !== true) throw new VtRejectedError("Avsender for tellerapporter er ikke konfigurert.", "503");
      const sig = JSON.stringify([i.countId, i.hash, i.countRevision, i.recipient.trim(), i.subject.trim(), i.message]);
      const prev = mail.get(i.opId);
      if (prev) { if (prev.sig !== sig) throw new VtRejectedError("Operasjons-ID er brukt med annet innhold", "23505"); return { state: prev.state, detail: null, replayed: true }; }
      const cur = await preview(i.countId);
      if (cur.hash !== i.hash || cur.countRevision !== i.countRevision) throw new VtRejectedError("Rapporten er endret siden forhåndsvisningen. Åpne forhåndsvisningen på nytt.", "409");
      const outcome = opts.mailOutcome ?? "akseptert_av_tjenesten";
      if (outcome === "tapt_svar") { mail.set(i.opId, { sig, state: "akseptert_av_tjenesten" }); throw new VtUnknownOutcomeError(); }
      mail.set(i.opId, { sig, state: outcome });
      return { state: outcome, detail: outcome === "ukjent" ? "Nettverksfeil eller tidsavbrudd" : null, replayed: false };
    },
    async listAssignments() { unavailable(); return assign.map(a => ({ ...a })); },
    async assign(i) {
      unavailable();
      const at = assign.findIndex(a => a.count_list_id === i.listId && a.user_id === i.userId && a.role === i.role);
      if (i.remove) { if (at >= 0) assign.splice(at, 1); } else if (at < 0) assign.push({ count_list_id: i.listId, user_id: i.userId, role: i.role });
    },
    async listUnits() {
      unavailable();
      return [...st.units.entries()].flatMap(([rm, us]) => us.map(u => ({ id: u.id, raw_material_id: rm, label: u.label, units_in_base: u.units_in_base })));
    },
  };
}
