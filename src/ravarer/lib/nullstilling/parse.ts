// «Nullstill køen» – strenge lesere for svarene fra rm_queue_reset_*. Ukjent form = null (vises som ukjent, aldri som 0/ferdig).
import { bool, isObj, num, str, type Obj } from "@/fakturaer/lib/parseRpcJson";
import { isCloseReason, type Action, type Catalog, type CatalogLink, type CloseReason, type ItemPayload, type PackagePayload, type Rule, type SnapLine } from "./types";

const RULE_SET = new Set([1, 2, 3, 4, 6]);
const ACTIONS: readonly Action[] = ["ikke_vare", "godta_pris", "bekreft_pakning", "koble", "opprett", "hold_utenfor"];
export const isRule = (v: unknown): v is Rule => typeof v === "number" && RULE_SET.has(v);
export const isAction = (v: unknown): v is Action => typeof v === "string" && (ACTIONS as readonly string[]).includes(v);
const strArr = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

export function parseSnapLine(v: unknown): SnapLine | null {
  if (!isObj(v)) return null;
  const line_id = str(v, "line_id"), invoice_id = str(v, "invoice_id"), line_updated_at = str(v, "line_updated_at");
  const invoice_read_codes = strArr(v.invoice_read_codes);
  if (!line_id || !invoice_id || !line_updated_at || !invoice_read_codes || !Array.isArray(v.extraction_issues)) return null;
  return {
    line_id, invoice_id, line_updated_at,
    invoice_number: str(v, "invoice_number"), invoice_date: str(v, "invoice_date"), supplier_id: str(v, "supplier_id"), supplier_name: str(v, "supplier_name"),
    lines_sum_status: str(v, "lines_sum_status"), is_credit_note: bool(v, "is_credit_note") === true, approved: bool(v, "approved") === true,
    cost_posted: bool(v, "cost_posted") === true, item_key: str(v, "item_key"), supplier_sku: str(v, "supplier_sku"), description: str(v, "description"),
    quantity: num(v, "quantity"), unit: str(v, "unit"), unit_price: num(v, "unit_price"), total_amount: num(v, "total_amount"),
    discount_amount: num(v, "discount_amount"), unit_price_basis: str(v, "unit_price_basis"), line_kind: str(v, "line_kind"),
    extraction_issues: v.extraction_issues,
    package_size: num(v, "package_size"), package_unit: str(v, "package_unit"), count_per_package: num(v, "count_per_package"),
    raw_material_id: str(v, "raw_material_id"), match_confidence: str(v, "match_confidence"), review_reason: str(v, "review_reason"),
    price_per_base_unit: num(v, "price_per_base_unit"), expected_price_per_base_unit: num(v, "expected_price_per_base_unit"),
    price_variance_pct: num(v, "price_variance_pct"), invoice_read_codes, exclusion_blocker: str(v, "exclusion_blocker"),
    rm_name: str(v, "rm_name"), rm_base_unit: str(v, "rm_base_unit"), rm_cost: num(v, "rm_cost"), rm_active: bool(v, "rm_active") !== false,
  };
}

/** Én side. Én uleselig rad gjør hele siden ukjent (ingen stille utelatelse). */
export function parseSnapshotPage(d: unknown): { rows: SnapLine[]; next: string | null } | null {
  if (!isObj(d) || d.ok !== true || !Array.isArray(d.rows)) return null;
  const rows: SnapLine[] = [];
  for (const r of d.rows) { const p = parseSnapLine(r); if (!p) return null; rows.push(p); }
  return { rows, next: str(d, "next_after") };
}

export function parseCatalog(d: unknown): Catalog | null {
  if (!isObj(d) || d.ok !== true || !Array.isArray(d.suppliers) || !Array.isArray(d.links)) return null;
  const suppliers: Catalog["suppliers"] = [];
  for (const s of d.suppliers) { if (!isObj(s) || !str(s, "id")) return null; suppliers.push({ id: str(s, "id")!, name: str(s, "name"), new_item_type: str(s, "new_item_type") }); }
  const links: CatalogLink[] = [];
  for (const l of d.links) {
    if (!isObj(l)) return null;
    const supplier_id = str(l, "supplier_id"), raw_material_id = str(l, "raw_material_id"), skus = strArr(l.skus);
    if (!supplier_id || !raw_material_id || !skus) return null;
    links.push({ supplier_id, raw_material_id, name: str(l, "name") ?? "", base_unit: str(l, "base_unit"), is_active: bool(l, "is_active") !== false, cost: num(l, "cost"), skus });
  }
  return { suppliers, links };
}

function parsePackage(v: unknown): PackagePayload | null {
  if (!isObj(v)) return null;
  const size = num(v, "package_size"), unit = str(v, "package_unit"), bupp = num(v, "base_units_per_package");
  return size != null && unit && bupp != null ? { package_size: size, package_unit: unit, base_units_per_package: bupp, confirm: true } : null;
}

export function parsePayload(v: unknown): ItemPayload {
  const o: Obj = isObj(v) ? v : {};
  const nr = isObj(o.new_raw_material) ? o.new_raw_material : null;
  const lines = Array.isArray(o.lines) ? o.lines.flatMap((x) => (isObj(x) && str(x, "id") ? [{ id: str(x, "id")!, price_per_base_unit: num(x, "price_per_base_unit") }] : [])) : undefined;
  return {
    title: str(o, "title") ?? "", supplier_name: str(o, "supplier_name"), cost_before: num(o, "cost_before"),
    package: parsePackage(o.package),
    new_raw_material: nr && str(nr, "name") && str(nr, "base_unit")
      ? { name: str(nr, "name")!, base_unit: str(nr, "base_unit")!, item_type: str(nr, "item_type") ?? "ravare", category: str(nr, "category") ?? "" } : undefined,
    lines, invoice_id: str(o, "invoice_id") ?? undefined, line_updated_at: str(o, "line_updated_at") ?? undefined, reason_text: str(o, "reason_text") ?? undefined, detail: str(o, "detail"),
  };
}

export type ItemStatus = "venter" | "pagar" | "ferdig" | "feilet" | "uavklart" | "hoppet_over";
export type RunStatus = "aktiv" | "pause" | "stoppet" | "ferdig";
const ITEM_STATUSES: readonly ItemStatus[] = ["venter", "pagar", "ferdig", "feilet", "uavklart", "hoppet_over"];
const RUN_STATUSES: readonly RunStatus[] = ["aktiv", "pause", "stoppet", "ferdig"];
export const isItemStatus = (v: unknown): v is ItemStatus => typeof v === "string" && (ITEM_STATUSES as readonly string[]).includes(v);
const isRunStatus = (v: unknown): v is RunStatus => typeof v === "string" && (RUN_STATUSES as readonly string[]).includes(v);

export interface ClaimedItem {
  id: string; seq: number; phase: 1 | 2; rule: Rule; action: Action; supplier_id: string | null; item_key: string | null;
  raw_material_id: string | null; line_ids: string[]; payload: ItemPayload; reason_code: CloseReason | null; op_id: string; claim_token: string; attempts: number;
}

export function parseClaimedItem(v: unknown): ClaimedItem | null {
  if (!isObj(v)) return null;
  const id = str(v, "id"), op_id = str(v, "op_id"), claim_token = str(v, "claim_token"), line_ids = strArr(v.line_ids), seq = num(v, "seq"), phase = num(v, "phase");
  if (!id || !op_id || !claim_token || !line_ids || line_ids.length === 0 || seq == null || (phase !== 1 && phase !== 2) || !isRule(v.rule) || !isAction(v.action)) return null;
  const rc = str(v, "reason_code");
  return { id, seq, phase, rule: v.rule, action: v.action, supplier_id: str(v, "supplier_id"), item_key: str(v, "item_key"), raw_material_id: str(v, "raw_material_id"),
    line_ids, payload: parsePayload(v.payload), reason_code: isCloseReason(rc) ? rc : null, op_id, claim_token, attempts: num(v, "attempts") ?? 1 };
}

export function parseClaim(d: unknown): { status: RunStatus; phase: 1 | 2; items: ClaimedItem[] } | null {
  if (!isObj(d) || d.ok !== true || !isRunStatus(d.status) || !Array.isArray(d.items)) return null;
  const phase = num(d, "phase");
  if (phase !== 1 && phase !== 2) return null;
  const items: ClaimedItem[] = [];
  for (const x of d.items) { const p = parseClaimedItem(x); if (!p) return null; items.push(p); }
  return { status: d.status, phase, items };
}

export interface CountRow { phase: 1 | 2; rule: Rule; action: Action; status: ItemStatus; reason_code: string | null; items: number; lines: number; undone: number }
export interface FailedRow { id: string; phase: number; rule: Rule; action: Action; error: string | null; supplier_name: string | null; item_key: string | null; title: string | null; lines: number }
export interface CostRow { raw_material_id: string; name: string; base_unit: string | null; before: number | null; now: number | null; created: boolean }
export interface RunInfo {
  id: string; label: string; status: RunStatus; phase: 1 | 2; snapshotCount: number; createdAt: string; finishedAt: string | null;
  priceJumpSetAt: string | null; limitBefore: number | null; quietBefore: boolean | null; rematchInvoices: number | null;
}
export interface ResetStatus { canRun: boolean; run: RunInfo | null; counts: CountRow[]; failed: FailedRow[]; costChanges: CostRow[]; createdItems: number; stillOpen: number; pendingClaims: number; oldestClaim: string | null }

export function parseStatus(d: unknown): ResetStatus | null {
  if (!isObj(d) || d.ok !== true) return null;
  const canRun = bool(d, "can_run") === true;
  if (d.run === null || d.run === undefined) return { canRun, run: null, counts: [], failed: [], costChanges: [], createdItems: 0, stillOpen: 0, pendingClaims: 0, oldestClaim: null };
  const r = d.run;
  if (!isObj(r) || !str(r, "id") || !isRunStatus(r.status) || (r.phase !== 1 && r.phase !== 2) || !str(r, "created_at")) return null;
  const sb = isObj(r.settings_before) ? r.settings_before : null;
  const rem = isObj(r.rematch) ? r.rematch : null;
  const run: RunInfo = {
    id: str(r, "id")!, label: str(r, "label") ?? "Nullstilling", status: r.status, phase: r.phase, snapshotCount: num(r, "snapshot_count") ?? 0,
    createdAt: str(r, "created_at")!, finishedAt: str(r, "finished_at"), priceJumpSetAt: str(r, "price_jump_set_at"),
    limitBefore: sb ? num(sb, "price_jump_pct") : null, quietBefore: sb ? bool(sb, "quiet_prices") : null, rematchInvoices: rem ? num(rem, "invoices") : null,
  };
  if (!Array.isArray(d.counts) || !Array.isArray(d.failed) || !Array.isArray(d.cost_changes)) return null;
  const counts: CountRow[] = [];
  for (const c of d.counts) {
    if (!isObj(c) || !isRule(c.rule) || !isAction(c.action) || !isItemStatus(c.status) || (c.phase !== 1 && c.phase !== 2)) return null;
    counts.push({ phase: c.phase, rule: c.rule, action: c.action, status: c.status, reason_code: str(c, "reason_code"), items: num(c, "items") ?? 0, lines: num(c, "lines") ?? 0, undone: num(c, "undone") ?? 0 });
  }
  const failed: FailedRow[] = d.failed.flatMap((f) => (isObj(f) && str(f, "id") && isRule(f.rule) && isAction(f.action)
    ? [{ id: str(f, "id")!, phase: num(f, "phase") ?? 1, rule: f.rule, action: f.action, error: str(f, "error"), supplier_name: str(f, "supplier_name"), item_key: str(f, "item_key"), title: str(f, "title"), lines: num(f, "lines") ?? 0 }] : []));
  const costChanges: CostRow[] = d.cost_changes.flatMap((c) => (isObj(c) && str(c, "raw_material_id")
    ? [{ raw_material_id: str(c, "raw_material_id")!, name: str(c, "name") ?? "", base_unit: str(c, "base_unit"), before: num(c, "before"), now: num(c, "now"), created: bool(c, "created") === true }] : []));
  const createdItems = num(d, "created_items"), stillOpen = num(d, "still_open"), pendingClaims = num(d, "pending_claims");
  if (createdItems == null || stillOpen == null || pendingClaims == null) return null;
  return { canRun, run, counts, failed, costChanges, createdItems, stillOpen, pendingClaims, oldestClaim: str(d, "oldest_claim") };
}

/** Sum over tellerader med filter. */
export function sumCounts(rows: readonly CountRow[], f: (r: CountRow) => boolean): { items: number; lines: number } {
  return rows.filter(f).reduce((s, r) => ({ items: s.items + r.items, lines: s.lines + r.lines }), { items: 0, lines: 0 });
}
