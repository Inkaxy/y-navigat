// «Nullstill køen» – stegene i en kjøring (lesing med RLS) og angring av ett steg med de eksisterende angre-funksjonene.
import { supabase } from "@/integrations/supabase/client";
import { callPendingRpc, pendingSelect } from "@/lib/pendingRpc";
import { isObj, num, str } from "@/fakturaer/lib/parseRpcJson";
import { parseExclusionResult } from "@/fakturaer/lib/invoiceExclusion";
import { isAction, isItemStatus, isRule, parsePayload, type ItemStatus } from "./parse";
import { canUndoAction, classifyUndo, undoReason, UNDO_LIMITS, type UndoOutcome } from "./undo";
import { isCloseReason, type Action, type CloseReason, type ItemPayload, type Rule } from "./types";

export interface RunItemRow {
  id: string; phase: number; seq: number; rule: Rule; action: Action; status: ItemStatus; supplier_id: string | null; item_key: string | null;
  raw_material_id: string | null; created_raw_material_id: string | null; line_ids: string[]; payload: ItemPayload; reason_code: CloseReason | null;
  op_id: string; error: string | null; undo_status: string | null;
}
const COLS = "id,phase,seq,rule,action,status,supplier_id,item_key,raw_material_id,created_raw_material_id,line_ids,payload,reason_code,op_id,error,undo_status";

function parseRow(v: unknown): RunItemRow | null {
  if (!isObj(v) || !str(v, "id") || !str(v, "op_id") || !Array.isArray(v.line_ids)) return null;
  const rule = v.rule, action = v.action, status = v.status;
  if (!isRule(rule) || !isAction(action) || !isItemStatus(status)) return null;
  const rc = str(v, "reason_code");
  return {
    id: str(v, "id")!, phase: num(v, "phase") ?? 1, seq: num(v, "seq") ?? 0, rule, action, status,
    supplier_id: str(v, "supplier_id"), item_key: str(v, "item_key"), raw_material_id: str(v, "raw_material_id"), created_raw_material_id: str(v, "created_raw_material_id"),
    line_ids: v.line_ids.filter((x): x is string => typeof x === "string"), payload: parsePayload(v.payload), reason_code: isCloseReason(rc) ? rc : null,
    op_id: str(v, "op_id")!, error: str(v, "error"), undo_status: str(v, "undo_status"),
  };
}

/** Komplett liste (sider à 1000). `filter` er PostgREST-filtre, f.eks. `rule=eq.6&status=eq.ferdig`. */
export async function fetchRunItems(runId: string, filter: string, order = "phase.asc,seq.asc"): Promise<RunItemRow[]> {
  const out: RunItemRow[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const r = await pendingSelect("rm_queue_reset_items", `select=${COLS}&run_id=eq.${runId}${filter ? `&${filter}` : ""}&order=${order}&limit=1000&offset=${off}`);
    if (r.kind !== "ok" || !Array.isArray(r.data)) throw new Error("Kunne ikke lese stegene i kjøringen.");
    for (const x of r.data) { const p = parseRow(x); if (!p) throw new Error("Uleselig steg i kjøringen."); out.push(p); }
    if (r.data.length < 1000) return out;
  }
  return out;
}

async function pendingUndo(name: string, args: Record<string, unknown>, wanted: number): Promise<UndoOutcome> {
  const r = await callPendingRpc(name, args);
  if (r.kind === "ok") return classifyUndo(r.data, wanted);
  if (r.kind === "denied") return { status: "kan_ikke", result: {}, message: "Mangler skrivetilgang." };
  if (r.kind === "missing") return { status: "kan_ikke", result: {}, message: "Angre-funksjonen finnes ikke i databasen." };
  return { status: "ukjent", message: "Utfallet er ukjent." };
}

async function reopenLine(row: RunItemRow, reason: string): Promise<UndoOutcome> {
  const lineId = row.line_ids[0];
  const { data: l, error } = await supabase.from("invoice_lines").select("id, invoice_id, updated_at, excluded_at, exclusion_prev").eq("id", lineId).maybeSingle();
  if (error || !l) return { status: "ukjent", message: "Kunne ikke lese linjen." };
  const prevOp = isObj(l.exclusion_prev) ? str(l.exclusion_prev, "op_id") : null;
  if (!l.excluded_at) return { status: "angret", result: { already_open: true }, message: "Linjen er allerede åpen." };
  if (prevOp !== row.op_id) return { status: "kan_ikke", result: {}, message: "Linjen er holdt utenfor av noe annet enn nullstillingen." };
  if (!l.updated_at) return { status: "ukjent", message: "Linjen mangler versjon." };
  const { data, error: e2 } = await supabase.rpc("rm_reopen_invoice_exclusion", { p_invoice_id: l.invoice_id, p_scope: "line", p_line_id: lineId, p_expected_updated_at: l.updated_at, p_reason: reason });
  if (e2) return { status: "ukjent", message: "Utfallet er ukjent." };
  const r = parseExclusionResult(data);
  if (r.kind === "ok") return { status: "angret", result: { reopened: 1 }, message: "Linjen er åpnet igjen." };
  if (r.kind === "rejected") return { status: "kan_ikke", result: { error: r.error }, message: "Linjen kunne ikke åpnes igjen (endret i mellomtiden)." };
  return { status: "ukjent", message: "Utfallet er ukjent." };
}

/** Angrer ett steg. Regel 3 (bekreft pakning) kan ikke angres herfra – se UNDO_LIMITS. */
export async function undoItem(le: string, runId: string, row: RunItemRow): Promise<UndoOutcome> {
  if (!canUndoAction(row.action)) return { status: "kan_ikke", result: {}, message: UNDO_LIMITS[row.action] ?? "Kan ikke angres." };
  const reason = undoReason(row.rule, runId, row.id);
  if (row.action === "hold_utenfor") return reopenLine(row, reason);
  if (row.action === "ikke_vare") {
    return pendingUndo("rm_undo_not_item", { p_legal_entity_id: le, p_supplier_id: row.supplier_id, p_item_key: row.item_key, p_line_ids: row.line_ids, p_remove_rule: true, p_reason: reason }, row.line_ids.length);
  }
  if (row.action === "godta_pris") {
    let undone = 0; let unknown = false;
    for (let i = 0; i < row.line_ids.length; i += 500) {
      const part = row.line_ids.slice(i, i + 500);
      const o = await pendingUndo("rm_undo_price_acceptance", { p_legal_entity_id: le, p_line_ids: part, p_reason: reason }, part.length);
      if (o.status === "ukjent") { unknown = true; break; }
      undone += Number(o.result.undone ?? 0);
    }
    if (unknown) return { status: "ukjent", message: "Utfallet er ukjent." };
    return classifyUndo({ ok: true, undone: Array.from({ length: undone }), skipped: [] }, row.line_ids.length);
  }
  const rm = row.created_raw_material_id ?? row.raw_material_id;
  if (!rm) return { status: "kan_ikke", result: {}, message: "Mangler varen steget koblet til." };
  return pendingUndo("rm_undo_supplier_item_link", { p_legal_entity_id: le, p_supplier_id: row.supplier_id, p_item_key: row.item_key, p_line_ids: row.line_ids,
    p_raw_material_id: rm, p_created: row.created_raw_material_id != null, p_reason: reason }, row.line_ids.length);
}
