import type { Json } from "@/integrations/supabase/types";
import { bool, isObj, num, str, type Obj } from "@/fakturaer/lib/parseRpcJson";
import {
  ACCEPT_SKIP_REASONS, WORK_GROUPS, WORK_KINDS,
  type AcceptPriceResult, type AcceptSkipReason, type ActivityFeed, type ActivityItem, type DataQualityCounts,
  type InvoiceCounts, type PriceMover, type PriceMovers, type SupplierItemCounts, type WorkItem, type WorkItemGroup,
  type WorkItemKind, type WorkItemsCounts, type WorkItemsResult, type WorkSummary,
} from "@/ravarer/lib/workRpcTypes";

export * from "@/ravarer/lib/workRpcTypes";

const arr = (o: Obj, k: string): unknown[] => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);
const objs = (o: Obj, k: string): Obj[] => arr(o, k).filter(isObj);
const n0 = (o: Obj, k: string): number => num(o, k) ?? 0;
const sub = (o: Obj, k: string): Obj | null => (isObj(o[k]) ? (o[k] as Obj) : null);

function counts<K extends string>(o: Obj | null, keys: readonly K[]): Record<K, number> | null {
  if (!o) return null;
  const r = {} as Record<K, number>;
  for (const k of keys) r[k] = n0(o, k);
  return r;
}

const SI_KEYS = ["koblet", "ukoblet", "mangler_pakning", "prisavvik", "kontroll", "ikke_vare"] as const;
const INV_KEYS = [
  "open_total", "missing_lines", "sum_mismatch", "needs_review", "ready_to_reconcile", "credit_notes_open", "flagged",
  "reconciled_total", "reconciled_auto", "reconciled_7d", "reconciled_auto_7d", "imported_7d",
] as const;
const DQ_KEYS = [
  "missing_package", "unconfirmed_package", "unstable_price", "missing_declaration", "missing_nutrition",
  "datasheet_changes", "active_items",
] as const;

export function parseWorkSummary(data: Json | null | undefined): WorkSummary {
  const d: Obj = isObj(data) ? data : {};
  const access = bool(d, "invoice_access") ?? false;
  const other = sub(d, "other") ?? {};
  const appr = sub(d, "approval");
  return {
    invoice_access: access,
    supplier_items: access ? (counts(sub(d, "supplier_items"), SI_KEYS) as SupplierItemCounts | null) : null,
    invoices: access ? (counts(sub(d, "invoices"), INV_KEYS) as InvoiceCounts | null) : null,
    lines_to_review: access ? num(d, "lines_to_review") : null,
    approval: access && appr ? { ready_to_approve: n0(appr, "ready_to_approve"), approved_total: n0(appr, "approved_total") } : null,
    data_quality: counts(sub(d, "data_quality") ?? {}, DQ_KEYS) as DataQualityCounts,
    other: {
      cases_open: num(other, "cases_open"),
      agreements_expiring_90d: n0(other, "agreements_expiring_90d"),
      agreements_expiring_30d: n0(other, "agreements_expiring_30d"),
      stock_below_min: n0(other, "stock_below_min"),
      rematch_pending: num(other, "rematch_pending"),
    },
    todo_total: access ? num(d, "todo_total") : null,
    generated_at: str(d, "generated_at"),
  };
}

const isGroup = (v: string | null): v is WorkItemGroup => !!v && v !== "alle" && (WORK_GROUPS as readonly string[]).includes(v);
const isKind = (v: string | null): v is WorkItemKind => !!v && (WORK_KINDS as readonly string[]).includes(v);

function parseWorkItem(o: Obj): WorkItem | null {
  const key = str(o, "key");
  const grp = str(o, "grp");
  const kind = str(o, "kind");
  if (!key || !isGroup(grp) || !isKind(kind)) return null;
  return {
    key, grp, kind, type: str(o, "type") === "faktura" ? "faktura" : "varekort",
    supplier_id: str(o, "supplier_id"), supplier_name: str(o, "supplier_name"), item_key: str(o, "item_key"),
    invoice_id: str(o, "invoice_id"), invoice_number: str(o, "invoice_number"), title: str(o, "title") ?? "",
    sku: str(o, "sku"), rm_id: str(o, "rm_id"), rm_name: str(o, "rm_name"),
    open_lines: n0(o, "open_lines"), open_invoices: n0(o, "open_invoices"), invoice_count: n0(o, "invoice_count"),
    amount: n0(o, "amount"), impact_nok: n0(o, "impact_nok"), last_date: str(o, "last_date"),
    last_open_line_id: str(o, "last_open_line_id"),
    reasons: arr(o, "reasons").filter((x): x is string => typeof x === "string"),
  };
}

const WI_COUNT_KEYS = [...WORK_GROUPS, "faktura_mangler_linjer", "faktura_sumavvik", "faktura_flagget", "faktura_klar"] as const;

export function parseWorkItems(data: Json | null | undefined): WorkItemsResult {
  const d: Obj = isObj(data) ? data : {};
  return {
    total: n0(d, "total"),
    counts: counts(sub(d, "counts") ?? {}, WI_COUNT_KEYS) as WorkItemsCounts,
    items: objs(d, "items").flatMap((o) => { const it = parseWorkItem(o); return it ? [it] : []; }),
    generated_at: str(d, "generated_at"),
  };
}

function parseActivity(o: Obj): ActivityItem | null {
  const id = str(o, "id");
  const at = str(o, "at");
  if (!id || !at) return null;
  return {
    id, at, kind: str(o, "kind") ?? "", actor: str(o, "actor") === "bruker" ? "bruker" : "system",
    user_name: str(o, "user_name"), title: str(o, "title") ?? "", subject: str(o, "subject"), detail: str(o, "detail"),
    invoice_id: str(o, "invoice_id"), raw_material_id: str(o, "raw_material_id"), count: num(o, "count") ?? 1,
  };
}

export function parseActivityFeed(data: Json | null | undefined): ActivityFeed {
  const d: Obj = isObj(data) ? data : {};
  const s = sub(d, "summary") ?? {};
  const summary: Record<string, number> = {};
  for (const k of Object.keys(s)) summary[k] = n0(s, k);
  return {
    since: str(d, "since"),
    items: objs(d, "items").flatMap((o) => { const it = parseActivity(o); return it ? [it] : []; }),
    summary, generated_at: str(d, "generated_at"),
  };
}

function parseMover(o: Obj): PriceMover | null {
  const id = str(o, "raw_material_id");
  if (!id) return null;
  return {
    raw_material_id: id, rm_name: str(o, "rm_name") ?? "", base_unit: str(o, "base_unit"),
    supplier_id: str(o, "supplier_id"), supplier_name: str(o, "supplier_name"),
    before_price: num(o, "before_price"), before_date: str(o, "before_date"),
    now_price: num(o, "now_price"), now_date: str(o, "now_date"), change_pct: num(o, "change_pct"),
    quantity: num(o, "quantity"), effect_nok: num(o, "effect_nok"), suspicious: bool(o, "suspicious") ?? false,
    points: objs(o, "points").flatMap((p) => {
      const date = str(p, "date"); const price = num(p, "price");
      return date && price != null ? [{ date, price }] : [];
    }),
  };
}

export function parsePriceMovers(data: Json | null | undefined): PriceMovers {
  const d: Obj = isObj(data) ? data : {};
  const s = sub(d, "summary") ?? {};
  return {
    days: n0(d, "days"), from: str(d, "from"),
    items: objs(d, "items").flatMap((o) => { const m = parseMover(o); return m ? [m] : []; }),
    summary: {
      changed: n0(s, "changed"), up: n0(s, "up"), down: n0(s, "down"), suspicious: n0(s, "suspicious"),
      effect_nok: n0(s, "effect_nok"), effect_up_nok: n0(s, "effect_up_nok"), effect_down_nok: n0(s, "effect_down_nok"),
    },
    generated_at: str(d, "generated_at"),
  };
}

const isSkip = (v: string | null): v is AcceptSkipReason => !!v && (ACCEPT_SKIP_REASONS as readonly string[]).includes(v);

export function parseAcceptPrice(data: Json | null | undefined): AcceptPriceResult {
  const d: Obj = isObj(data) ? data : {};
  const rm = sub(d, "rematch");
  return {
    ok: bool(d, "ok") ?? false,
    error: str(d, "error"),
    accepted: n0(d, "accepted"), skipped: n0(d, "skipped"),
    accepted_lines: objs(d, "accepted_lines").flatMap((o) => {
      const id = str(o, "id"); return id ? [{ id, invoice_id: str(o, "invoice_id"), invoice_number: str(o, "invoice_number") }] : [];
    }),
    skipped_lines: objs(d, "skipped_lines").flatMap((o) => {
      const id = str(o, "id"); const r = str(o, "reason");
      return id ? [{ id, invoice_number: str(o, "invoice_number"), reason: isSkip(r) ? r : "feil", message: str(o, "message") ?? "" }] : [];
    }),
    invoices: arr(d, "invoices").filter((x): x is string => typeof x === "string"),
    rematch: rm ? { ok: bool(rm, "ok") ?? false, queued: n0(rm, "queued"), already_queued: n0(rm, "already_queued"), pending: n0(rm, "pending") } : null,
  };
}
