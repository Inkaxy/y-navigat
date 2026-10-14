// Orkestrering for «Les originalen på nytt», med injiserte avhengigheter slik at rekkefølgen
// (eier/tilgang/sti FØR nedlasting og leser) kan testes uten nettverk.
import { classifyDbError } from "../_shared/sqlstate.ts";
import { buildExtractorRequest, buildProposal, documentPathAllowed, looksLikePdf, sha256Hex, toBase64, type SnapshotInvoice, type SnapshotLine } from "./proposal.ts";

export type RunRow = {
  id: string; legal_entity_id: string; invoice_id: string; created_by: string; status: string;
  expires_at: string; document_path: string; snapshot: unknown;
};

export interface Deps {
  /** Kjøringen lest med brukerens rettigheter (RLS). */
  readRunAsUser(runId: string): Promise<RunRow | null>;
  hasWriteAccess(legalEntityId: string): Promise<boolean>;
  supplierName(legalEntityId: string, supplierId: string): Promise<string | null>;
  download(path: string): Promise<Uint8Array | null>;
  extract(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: unknown }>;
  register(runId: string, sha: string, proposal: unknown, extractor: unknown): Promise<{ ok: boolean; code?: string; replayed?: boolean } | "unknown">;
  fail(runId: string, code: string): Promise<void>;
  /** Lagret status og dokumentavtrykk lest med tjenestenøkkel (kan kaste). */
  readRunState(runId: string): Promise<{ status: string; document_sha256: string | null } | null>;
  now(): number;
}

/**
 * Svar fra rm_register_invoice_reread → utfall. Bare kjente SQLSTATE-er er avvisning; manglende/ugyldig
 * svar, nettverk, klasse 08 og 40003 er ukjent (kjøringen leses på nytt, aldri merket feilet).
 */
export function classifyRegister(data: unknown, error: { code?: string | null } | null): { ok: boolean; code?: string; replayed?: boolean } | "rejected" | "unknown" {
  if (error) return classifyDbError(error.code) === "rejected" ? "rejected" : "unknown";
  if (!isRec(data) || typeof data.ok !== "boolean") return "unknown";
  if (data.ok) return { ok: true, replayed: data.replayed === true };
  return typeof data.code === "string" ? { ok: false, code: data.code } : "unknown";
}

export type FlowResult = { status: number; body: { ok: boolean; run_id?: string; code?: string; replayed?: boolean } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export async function runPreview(deps: Deps, userId: string, runId: unknown): Promise<FlowResult> {
  if (typeof runId !== "string" || !UUID.test(runId)) return { status: 400, body: { ok: false, code: "ugyldig_kjoring" } };
  const run = await deps.readRunAsUser(runId);
  if (!run) return { status: 404, body: { ok: false, code: "finnes_ikke" } };
  if (run.created_by !== userId) return { status: 403, body: { ok: false, code: "annen_eier", run_id: run.id } };
  if (!(await deps.hasWriteAccess(run.legal_entity_id))) return { status: 403, body: { ok: false, code: "forbidden", run_id: run.id } };
  if (run.status !== "reading") return { status: 409, body: { ok: false, code: `status_${run.status}`, run_id: run.id } };
  if (Date.parse(run.expires_at) < deps.now()) return { status: 409, body: { ok: false, code: "reread_utlopt", run_id: run.id } };
  const snap = isRec(run.snapshot) ? run.snapshot : null;
  const inv = snap && isRec(snap.invoice) ? (snap.invoice as SnapshotInvoice & Record<string, unknown>) : null;
  const lines = snap && Array.isArray(snap.lines) ? (snap.lines.filter(isRec) as unknown as SnapshotLine[]) : [];
  // Stien må tilhøre kjøringens selskap — sjekkes før noe lastes ned med tjenestenøkkel.
  if (!inv || !documentPathAllowed(run.document_path, run.legal_entity_id) || (inv.legal_entity_id && inv.legal_entity_id !== run.legal_entity_id)) {
    await deps.fail(run.id, "dokumentsti_avvist");
    return { status: 400, body: { ok: false, code: "dokumentsti_avvist", run_id: run.id } };
  }
  // Transportfeil før registrering kan ikke ha endret fakturaen. En samtidig kjøring kan likevel bli ferdig:
  // les lagret status først — klar/avsluttet vinner; bare «reading» merkes feilet.
  const transportFailure = async (code: string): Promise<FlowResult> => {
    let state: { status: string } | null;
    try { state = await deps.readRunState(run.id); } catch { return { status: 202, body: { ok: false, code: "ukjent_utfall", run_id: run.id } }; }
    if (state?.status === "reading") { await deps.fail(run.id, code); return { status: 502, body: { ok: false, code, run_id: run.id } }; }
    return { status: 409, body: { ok: false, code: `status_${state?.status ?? "ukjent"}`, run_id: run.id } };
  };
  let pdf: Uint8Array | null;
  try { pdf = await deps.download(run.document_path); } catch { return transportFailure("dokument_transportfeil"); }
  if (!pdf || !looksLikePdf(pdf)) {
    await deps.fail(run.id, pdf ? "ikke_pdf" : "dokument_mangler");
    return { status: 422, body: { ok: false, code: pdf ? "ikke_pdf" : "dokument_mangler", run_id: run.id } };
  }
  const sha = await sha256Hex(pdf);
  const supplierName = inv.supplier_id ? await deps.supplierName(run.legal_entity_id, inv.supplier_id) : null;
  const req = buildExtractorRequest({ legalEntityId: run.legal_entity_id, invoice: inv, lines, supplierName, pdfBase64: toBase64(pdf), invoiceId: run.invoice_id });
  let ex: { ok: boolean; status: number; json: unknown };
  try { ex = await deps.extract(req); } catch { return transportFailure("leser_transportfeil"); }
  if (!ex.ok) {
    await deps.fail(run.id, "leser_feilet");
    return { status: 502, body: { ok: false, code: "leser_feilet", run_id: run.id } };
  }
  const built = buildProposal(ex.json, { invoice: inv });
  if (!built.ok) {
    await deps.fail(run.id, built.code);
    return { status: 422, body: { ok: false, code: built.code, run_id: run.id } };
  }
  const reg = await deps.register(run.id, sha, built.proposal, built.extractor);
  // Usikkert utfall: aldri merk som feilet. Les lagret kjøring; samme dokument klart = vår registrering.
  if (reg === "unknown") {
    try {
      const st = await deps.readRunState(run.id);
      if (st?.status === "ready" && st.document_sha256 === sha) return { status: 200, body: { ok: true, run_id: run.id, replayed: true } };
    } catch { /* fortsatt ukjent */ }
    return { status: 202, body: { ok: false, code: "ukjent_utfall", run_id: run.id } };
  }
  if (!reg.ok) return { status: 409, body: { ok: false, code: reg.code ?? "registrering_avvist", run_id: run.id } };
  return { status: 200, body: { ok: true, run_id: run.id, replayed: reg.replayed === true } };
}
