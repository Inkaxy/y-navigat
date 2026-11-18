// «Nullstill køen» – kall mot serveren. Nye funksjoner (01_nullstill_koen.sql) går via callPendingRpc (finnes ikke i typefilen
// før filen er kjørt). Handlingene bruker eksisterende skriveveier, se execute.ts.
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { callPendingRpc, pendingSelect, type PendingResult } from "@/lib/pendingRpc";
import { isObj, parseLinkResult } from "@/fakturaer/lib/parseRpcJson";
import { parseExclusionResult } from "@/fakturaer/lib/invoiceExclusion";
import { parseAcceptPrice } from "@/ravarer/lib/workRpc";
import type { Json } from "@/integrations/supabase/types";
import type { LinkSupplierItemBody } from "@/fakturaer/lib/supplierItems";
import type { ExecDeps, LinkOutcome } from "./execute";
import { parseCatalog, parseClaim, parseSnapshotPage, parseStatus, type ResetStatus } from "./parse";
import type { Catalog, PlanItem, SnapLine } from "./types";

const isJson = (v: unknown): v is Json => v === null || ["object", "string", "number", "boolean"].includes(typeof v);

export class ResetError extends Error {
  constructor(message: string, readonly kind: "missing" | "denied" | "rejected" | "unknown") { super(message); }
}
function need<T>(r: PendingResult, parse: (d: unknown) => T | null, what: string): T {
  if (r.kind === "missing") throw new ResetError("Databasefilen for nullstilling er ikke kjørt ennå.", "missing");
  if (r.kind === "denied") throw new ResetError("Bare godkjennere og administratorer kan nullstille køen.", "denied");
  if (r.kind === "error") throw new ResetError(`${what}: utfallet er ukjent (nettverk eller server). Prøv igjen.`, "unknown");
  const p = parse(r.data);
  if (p == null) throw new ResetError(`${what}: uleselig svar fra serveren.`, "unknown");
  return p;
}

/** Alle åpne linjer i sider à 500 (id-keyset). Komplett eller feil – aldri en avkortet liste. */
export async function fetchSnapshot(le: string, onProgress?: (n: number) => void): Promise<SnapLine[]> {
  const out: SnapLine[] = [];
  let after: string | null = null;
  for (let i = 0; i < 100; i++) {
    const page: NonNullable<ReturnType<typeof parseSnapshotPage>> = need(await callPendingRpc("rm_queue_reset_snapshot_lines", { p_legal_entity_id: le, p_after: after, p_limit: 500 }), parseSnapshotPage, "Kunne ikke hente køen");
    out.push(...page.rows);
    onProgress?.(out.length);
    if (!page.next) return out;
    after = page.next;
  }
  throw new ResetError("Køen er for stor til å hentes i én forhåndsvisning.", "unknown");
}

export const fetchCatalog = async (le: string): Promise<Catalog> =>
  need(await callPendingRpc("rm_queue_reset_catalog", { p_legal_entity_id: le }), parseCatalog, "Kunne ikke hente varene");

export const fetchStatus = async (le: string): Promise<ResetStatus> =>
  need(await callPendingRpc("rm_queue_reset_status", { p_legal_entity_id: le }), parseStatus, "Kunne ikke lese nullstillingen");

const wire = (i: PlanItem) => ({ rule: i.rule, action: i.action, supplier_id: i.supplier_id, item_key: i.item_key, raw_material_id: i.raw_material_id,
  line_ids: i.line_ids, reason_code: i.reason_code, payload: i.payload });

type OkOr = { ok: true; data: Record<string, unknown> } | { ok: false; error: string; data: Record<string, unknown> };
const okOr = (d: unknown): OkOr | null => (isObj(d) && typeof d.ok === "boolean" ? (d.ok ? { ok: true, data: d } : { ok: false, error: typeof d.error === "string" ? d.error : "avvist", data: d }) : null);

export async function startRun(le: string, fingerprint: string, summary: unknown, snapshot: string[], items: PlanItem[]): Promise<OkOr> {
  return need(await callPendingRpc("rm_queue_reset_start", { p_legal_entity_id: le, p_fingerprint: fingerprint, p_summary: summary, p_snapshot: snapshot, p_items: items.map(wire) }), okOr, "Kunne ikke starte");
}
export async function addPhase2(runId: string, items: PlanItem[]): Promise<OkOr> {
  return need(await callPendingRpc("rm_queue_reset_add_phase2", { p_run_id: runId, p_items: items.map(wire) }), okOr, "Kunne ikke legge til fase 2");
}
export const claim = async (runId: string, limit = 5) => need(await callPendingRpc("rm_queue_reset_claim", { p_run_id: runId, p_limit: limit }), parseClaim, "Kunne ikke hente neste bolk");
export async function finish(itemId: string, token: string, status: string, result: unknown, error: string | null): Promise<OkOr | null> {
  const r = await callPendingRpc("rm_queue_reset_finish", { p_item_id: itemId, p_claim_token: token, p_status: status, p_result: result, p_error: error });
  return r.kind === "ok" ? okOr(r.data) : null;
}
export const recover = async (runId: string, staleSeconds: number) => need(await callPendingRpc("rm_queue_reset_recover", { p_run_id: runId, p_stale_seconds: staleSeconds }), okOr, "Kunne ikke kontrollere pågående steg");
export const checkItem = async (itemId: string) => need(await callPendingRpc("rm_queue_reset_check", { p_item_id: itemId }), okOr, "Kunne ikke kontrollere steget");
export const setRunStatus = async (runId: string, action: "pause" | "fortsett" | "stopp") => need(await callPendingRpc("rm_queue_reset_set_status", { p_run_id: runId, p_action: action }), okOr, "Kunne ikke endre kjøringen");
export const completeRun = async (runId: string) => need(await callPendingRpc("rm_queue_reset_complete", { p_run_id: runId }), okOr, "Kunne ikke avslutte");
export const setLimit = async (runId: string) => need(await callPendingRpc("rm_queue_reset_set_limit", { p_run_id: runId }), okOr, "Kunne ikke sette grensen");
export const undoMark = async (itemId: string, status: string, result: unknown) => need(await callPendingRpc("rm_queue_reset_undo_mark", { p_item_id: itemId, p_status: status, p_result: result }), okOr, "Kunne ikke registrere angring");

/** Omregningskøen for selskapet (fase 2 planlegges først når den er tom). null = ukjent. */
export async function rematchPending(le: string): Promise<number | null> {
  const { data, error } = await supabase.rpc("rm_rematch_status", { p_legal_entity_id: le });
  if (error || !isObj(data)) return null;
  const q = Number(data.queued), f = Number(data.in_flight);
  return Number.isFinite(q) && Number.isFinite(f) ? q + f : null;
}

/** Linje-id-ene i kjøringens utvalg (komplett, i sider). */
export async function fetchRunSnapshot(runId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const r = await pendingSelect("rm_queue_reset_snapshot", `select=line_id&run_id=eq.${runId}&order=line_id&limit=1000&offset=${from}`);
    if (r.kind !== "ok" || !Array.isArray(r.data)) throw new ResetError("Kunne ikke lese utvalget for kjøringen.", "unknown");
    const rows: unknown[] = r.data;
    for (const r of rows) if (isObj(r) && typeof r.line_id === "string") ids.add(r.line_id);
    if (rows.length < 1000) return ids;
  }
}

async function invokeLink(body: LinkSupplierItemBody): Promise<LinkOutcome> {
  const { data, error } = await supabase.functions.invoke("link-supplier-item", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context instanceof Response ? error.context.status : 0;
      let msg = "Koblingen ble avvist.";
      try { const b: unknown = await error.context.json(); if (isObj(b) && typeof b.error === "string") msg = b.error; } catch { msg = "Koblingen ble avvist (uleselig svar)."; }
      // 4xx = sikker avvisning (ingenting lagret). 5xx kan ha lagret koblingen før feilen → ukjent.
      return status >= 400 && status < 500 ? { kind: "rejected", message: msg } : { kind: "unknown", message: msg };
    }
    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) return { kind: "unknown", message: "Nettverksfeil – utfallet er ukjent." };
    return { kind: "unknown", message: "Utfallet er ukjent." };
  }
  const r = parseLinkResult(data);
  if ("error" in r) return { kind: "unknown", message: r.error || "Uleselig svar fra koblingen." };
  return { kind: "ok", r };
}

/** Ekte avhengigheter for utføreren. */
export const liveDeps: ExecDeps = {
  link: invokeLink,
  rememberNames: async ({ le, supplierId, itemKey, rmsId }) =>
    (await callPendingRpc("rm_remember_supplier_item_names", { p_legal_entity_id: le, p_supplier_id: supplierId, p_item_key: itemKey, p_raw_material_supplier_id: rmsId })).kind === "ok",
  acceptPrice: async ({ le, supplierId, itemKey, lines, reason }) => {
    const { data, error } = await supabase.rpc("rm_supplier_item_accept_price", { p_legal_entity_id: le, p_supplier_id: supplierId, p_item_key: itemKey, p_lines: lines, p_reason: reason });
    if (error) return error.code ? { kind: "rejected", message: error.code === "42501" ? "Mangler skrivetilgang til fakturaer." : "Prisen ble avvist av serveren." } : { kind: "unknown", message: "Nettverksfeil – utfallet er ukjent." };
    const r = parseAcceptPrice(isJson(data) ? data : null);
    if (!r.ok) return r.error ? { kind: "rejected", message: r.error } : { kind: "unknown", message: "Uleselig svar." };
    return { kind: "ok", accepted: r.accepted, skipped: r.skipped_lines.map((s) => ({ id: s.id, message: s.message })) };
  },
  exclude: async ({ invoiceId, lineId, reason, expectedUpdatedAt, opId }) => {
    const { data, error } = await supabase.rpc("rm_set_invoice_exclusion", {
      p_invoice_id: invoiceId, p_scope: "line", p_line_id: lineId, p_category: "nullstilling", p_reason: reason, p_expected_updated_at: expectedUpdatedAt, p_op_id: opId,
    });
    if (error) return error.code === "42501" ? { kind: "denied" } : { kind: "unknown" };
    return parseExclusionResult(isJson(data) ? data : null);
  },
  lineVersion: async (lineId) => {
    const { data, error } = await supabase.from("invoice_lines").select("id, invoice_id, updated_at, requires_review, excluded_at").eq("id", lineId).maybeSingle();
    if (error || !data || !data.updated_at) return null;
    return { open: data.requires_review === true && data.excluded_at == null, updatedAt: data.updated_at, invoiceId: data.invoice_id };
  },
};
