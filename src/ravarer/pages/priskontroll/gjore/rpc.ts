import type { Json } from "@/integrations/supabase/types";
import { isObj, num, str, type Obj } from "@/fakturaer/lib/parseRpcJson";
import { ACCEPT_SKIP_REASONS, type AcceptSkipReason } from "@/ravarer/lib/workRpcTypes";
import type { ClaimFailure } from "./logic";

type Skipped = { id: string; invoice_number: string | null; reason: AcceptSkipReason; message: string };

const objs = (o: Obj, k: string): Obj[] => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter(isObj) : []);
const isSkip = (v: string | null): v is AcceptSkipReason => !!v && (ACCEPT_SKIP_REASONS as readonly string[]).includes(v);
const count = (o: Obj, k: string): number => (Array.isArray(o[k]) ? (o[k] as unknown[]).length : num(o, k) ?? 0);

function skipped(o: Obj): Skipped[] {
  return objs(o, "skipped_lines").flatMap((s) => {
    const id = str(s, "id");
    const r = str(s, "reason");
    return id ? [{ id, invoice_number: str(s, "invoice_number"), reason: isSkip(r) ? r : "feil", message: str(s, "message") ?? "" }] : [];
  });
}

function rematchQueued(o: Obj): number {
  const r = o.rematch;
  return isObj(r) ? num(r, "queued") ?? 0 : 0;
}

export type ClaimCreditResult =
  | { ok: true; caseId: string | null; caseLines: number; accepted: number; skipped: Skipped[]; rematchQueued: number; caseKind: "documented_claim" | "price_inquiry" | null }
  | { ok: false; reason: ClaimFailure; skipped: Skipped[] };

export function parseClaimCredit(data: Json | null | undefined): ClaimCreditResult {
  const d: Obj = isObj(data) ? data : {};
  if (d.ok === true) {
    const k = str(d, "case_kind");
    return { ok: true, caseId: str(d, "case_id"), caseLines: count(d, "case_lines"), accepted: num(d, "accepted") ?? 0, skipped: skipped(d), rematchQueued: rematchQueued(d),
      caseKind: k === "documented_claim" || k === "price_inquiry" ? k : null };
  }
  const reason: ClaimFailure = str(d, "reason") === "ingen_godtatt" ? "ingen_godtatt" : "ingen_merkostnad";
  return { ok: false, reason, skipped: skipped(d) };
}

export type ChangeLinkResult = { ok: boolean; changedLineIds: string[]; lockedLines: number; rematchQueued: number };

export function parseChangeLink(data: Json | null | undefined): ChangeLinkResult {
  const d: Obj = isObj(data) ? data : {};
  const ids = Array.isArray(d.changed_line_ids) ? (d.changed_line_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return { ok: d.ok === true, changedLineIds: ids, lockedLines: count(d, "locked_lines"), rematchQueued: rematchQueued(d) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Streng lesing etter live-kontrakten til `rm_change_supplier_link`. Null = ukjent utfall.
 * Null flyttede linjer med `rematch:null` er gyldig suksess; låste linjer er et heltall.
 * Ved eksplisitt linjeutvalg må returnerte ID-er være en delmengde av det frosne utvalget.
 */
export function parseChangeLinkStrict(data: unknown, requestedLineIds: string[] | null): ChangeLinkResult | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true || !Array.isArray(d.changed_line_ids) || !nonNegInt(d.locked_lines)) return null;
  const ids: string[] = [];
  for (const x of d.changed_line_ids) {
    if (typeof x !== "string" || !UUID_RE.test(x)) return null;
    ids.push(x);
  }
  if (requestedLineIds) {
    const allowed = new Set(requestedLineIds);
    if (ids.some((x) => !allowed.has(x))) return null;
  }
  let queued = 0;
  if (d.rematch !== null) {
    const m = d.rematch;
    if (m === undefined || typeof m !== "object" || Array.isArray(m)) return null;
    const r = m as Record<string, unknown>;
    if (r.ok !== true || !nonNegInt(r.queued) || !nonNegInt(r.already_queued) || !nonNegInt(r.pending)) return null;
    queued = r.queued;
  }
  return { ok: true, changedLineIds: ids, lockedLines: d.locked_lines, rematchQueued: queued };
}
