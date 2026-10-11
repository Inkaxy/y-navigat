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
  | { ok: true; caseId: string | null; caseLines: number; accepted: number; skipped: Skipped[]; rematchQueued: number }
  | { ok: false; reason: ClaimFailure; skipped: Skipped[] };

export function parseClaimCredit(data: Json | null | undefined): ClaimCreditResult {
  const d: Obj = isObj(data) ? data : {};
  if (d.ok === true) {
    return { ok: true, caseId: str(d, "case_id"), caseLines: count(d, "case_lines"), accepted: num(d, "accepted") ?? 0, skipped: skipped(d), rematchQueued: rematchQueued(d) };
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
