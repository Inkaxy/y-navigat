import type { Json } from "@/integrations/supabase/types";
import {
  EMPTY_COUNTS,
  isSupplierItemStatus,
  SUPPLIER_ITEM_STATUSES,
  type LinkSupplierItemResult,
  type PackageInference,
  type SupplierItem,
  type SupplierItemLine,
  type SupplierItemsResult,
} from "@/fakturaer/lib/supplierItems";

/** Små, typede lesere for jsonb-svar fra RPC-er og Edge. Ukjente felt får trygge standardverdier. */
export type Obj = { [k: string]: unknown };

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (o: Obj, k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
export const num = (o: Obj, k: string): number | null => {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
export const bool = (o: Obj, k: string): boolean | null => (typeof o[k] === "boolean" ? (o[k] as boolean) : null);
const arr = (o: Obj, k: string): unknown[] => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);

function parseItem(o: Obj): SupplierItem | null {
  const supplier_id = str(o, "supplier_id");
  const item_key = str(o, "item_key");
  if (!supplier_id || !item_key) return null;
  const st = str(o, "status");
  return {
    supplier_id, item_key,
    supplier_name: str(o, "supplier_name"), supplier_sku: str(o, "supplier_sku"), description: str(o, "description"),
    line_count: num(o, "line_count") ?? 0, invoice_count: num(o, "invoice_count") ?? 0,
    first_seen: str(o, "first_seen"), last_seen: str(o, "last_seen"), open_lines: num(o, "open_lines") ?? 0,
    last_line_id: str(o, "last_line_id"), last_open_line_id: str(o, "last_open_line_id"),
    last_invoice_id: str(o, "last_invoice_id"), last_invoice_date: str(o, "last_invoice_date"),
    linked_rm_id: str(o, "linked_rm_id"), rm_id: str(o, "rm_id"), rm_name: str(o, "rm_name"), rm_sku: str(o, "rm_sku"),
    rm_base_unit: str(o, "rm_base_unit"), rm_category: str(o, "rm_category"), rm_cost: num(o, "rm_cost"),
    rms_id: str(o, "rms_id"), rms_notes: str(o, "rms_notes"), package_size: num(o, "package_size"), package_unit: str(o, "package_unit"),
    base_units_per_package: num(o, "base_units_per_package"), package_confirmed_at: str(o, "package_confirmed_at"),
    agreed_price_per_base_unit: num(o, "agreed_price_per_base_unit"), is_primary: bool(o, "is_primary"), variants: num(o, "variants"),
    last_ppbu: num(o, "last_ppbu"), prev_ppbu: num(o, "prev_ppbu"), last_conf: str(o, "last_conf"), reasons_raw: str(o, "reasons_raw"),
    status: isSupplierItemStatus(st) ? st : "kontroll",
  };
}

export function parseSupplierItemsResult(data: Json | null | undefined): SupplierItemsResult {
  if (!isObj(data)) return { total: 0, counts: { ...EMPTY_COUNTS }, items: [] };
  const c = isObj(data.counts) ? data.counts : {};
  const counts = { ...EMPTY_COUNTS };
  for (const s of SUPPLIER_ITEM_STATUSES) counts[s] = num(c, s) ?? 0;
  const items = arr(data, "items").flatMap((x) => {
    const it = isObj(x) ? parseItem(x) : null;
    return it ? [it] : [];
  });
  return { total: num(data, "total") ?? 0, counts, items };
}

function parseLine(o: Obj): SupplierItemLine | null {
  const id = str(o, "id");
  const invoice_id = str(o, "invoice_id");
  if (!id || !invoice_id) return null;
  return {
    id, invoice_id,
    invoice_number: str(o, "invoice_number"), invoice_date: str(o, "invoice_date"), invoice_status: str(o, "invoice_status"),
    flagged_at: str(o, "flagged_at"), is_credit_note: bool(o, "is_credit_note"), reconciled_mode: str(o, "reconciled_mode"),
    line_number: num(o, "line_number"), supplier_sku: str(o, "supplier_sku"), description: str(o, "description"),
    quantity: num(o, "quantity"), unit: str(o, "unit"), unit_price: num(o, "unit_price"), total_amount: num(o, "total_amount"),
    package_size: num(o, "package_size"), package_unit: str(o, "package_unit"), count_per_package: num(o, "count_per_package"),
    base_quantity: num(o, "base_quantity"), price_per_base_unit: num(o, "price_per_base_unit"),
    expected_price_per_base_unit: num(o, "expected_price_per_base_unit"), price_variance_pct: num(o, "price_variance_pct"),
    variance_status: str(o, "variance_status"), price_reference_source: str(o, "price_reference_source"),
    raw_material_id: str(o, "raw_material_id"), raw_material_name: str(o, "raw_material_name"), match_confidence: str(o, "match_confidence"),
    requires_review: bool(o, "requires_review"), review_reason: str(o, "review_reason"), resolution_note: str(o, "resolution_note"),
    created_at: str(o, "created_at"), line_kind: str(o, "line_kind"), cost_posted: bool(o, "cost_posted"), in_price_history: bool(o, "in_price_history"),
  };
}

export function parseSupplierItemLines(data: Json | null | undefined): SupplierItemLine[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((x) => {
    const l = isObj(x) ? parseLine(x) : null;
    return l ? [l] : [];
  });
}

const SOURCES = ["regnestykke_og_varenavn", "regnestykke", "varenavn"] as const;

export function parsePackageInference(data: Json | null | undefined): PackageInference {
  const o = isObj(data) ? data : {};
  const a = isObj(o.arithmetic) ? o.arithmetic : null;
  const d = isObj(o.description) ? o.description : null;
  const src = str(o, "source");
  return {
    ok: bool(o, "ok") ?? false,
    base_unit: str(o, "base_unit"), line_unit: str(o, "line_unit"),
    arithmetic: a ? { bupp: num(a, "bupp"), raw: num(a, "raw"), ok: bool(a, "ok") ?? false } : null,
    description: d ? { count: num(d, "count"), size: num(d, "size"), unit: str(d, "unit"), total: num(d, "total"), bupp: num(d, "bupp") } : null,
    agrees: bool(o, "agrees") ?? false,
    suggested_bupp: num(o, "suggested_bupp"),
    source: SOURCES.find((s) => s === src) ?? null,
    auto_confirmable: bool(o, "auto_confirmable") ?? false,
    direct: bool(o, "direct") ?? false,
    direct_factor: num(o, "direct_factor"),
    explanation: str(o, "explanation") ?? "",
  };
}

/** Edge-svaret fra link-supplier-item. Returnerer feiltekst når `ok` er usann eller svaret er uleselig. */
export function parseLinkResult(data: unknown): LinkSupplierItemResult | { error: string } {
  if (!isObj(data)) return { error: "" };
  if (bool(data, "ok") === false || str(data, "error")) return { error: str(data, "error") ?? "" };
  const invoices = arr(data, "invoices").flatMap((x) => {
    if (!isObj(x)) return [];
    const invoice_id = str(x, "invoice_id");
    if (!invoice_id) return [];
    return [{
      invoice_id, invoice_number: str(x, "invoice_number"), status: str(x, "status"), reconciled_mode: str(x, "reconciled_mode"),
      rematched: bool(x, "rematched") ?? true, requires_review_count: num(x, "requires_review_count") ?? 0,
      review_reasons: arr(x, "review_reasons").filter((r): r is string => typeof r === "string"),
      auto_reconcile: bool(x, "auto_reconcile") ?? false, error: str(x, "error"),
    }];
  });
  const failures = arr(data, "failures").flatMap((x) => {
    if (!isObj(x)) return [];
    const invoice_id = str(x, "invoice_id");
    return invoice_id ? [{ invoice_id, reason: str(x, "reason") ?? "Ukjent årsak" }] : [];
  });
  return {
    ok: true, mode: str(data, "mode") === "ikke_vare" ? "ikke_vare" : "koblet",
    raw_material_id: str(data, "raw_material_id"), raw_material_supplier_id: str(data, "raw_material_supplier_id"),
    created_raw_material: bool(data, "created_raw_material") ?? false, lines_updated: num(data, "lines_updated") ?? 0,
    invoices, still_open_lines: num(data, "still_open_lines") ?? 0, failures,
  };
}

export interface RematchStatus { queued: number; in_flight: number; done_last_hour: number; failed_last_day: number; last_finished_at: string | null }
export function parseRematchStatus(data: Json | null | undefined): RematchStatus {
  const o = isObj(data) ? data : {};
  return {
    queued: num(o, "queued") ?? 0, in_flight: num(o, "in_flight") ?? 0, done_last_hour: num(o, "done_last_hour") ?? 0,
    failed_last_day: num(o, "failed_last_day") ?? 0, last_finished_at: str(o, "last_finished_at"),
  };
}

export type PriceRefSource = "agreement" | "start_price" | "last_purchase" | "conflict" | "none";
export interface PriceReference { source: PriceRefSource; price: number | null; reference_date: string | null; valid_to: string | null; reason: string | null }
const REF_SOURCES: PriceRefSource[] = ["agreement", "start_price", "last_purchase", "conflict", "none"];
export function parsePriceReference(data: Json | null | undefined): PriceReference {
  const o = isObj(data) ? data : {};
  const s = str(o, "source");
  return {
    source: REF_SOURCES.find((x) => x === s) ?? "none", price: num(o, "price"),
    reference_date: str(o, "reference_date"), valid_to: str(o, "valid_to"), reason: str(o, "reason"),
  };
}

export type RepairVatResult =
  | { ok: true; mode: "linjer_skalert" | "mva_utledet"; lines: number }
  | { ok: false; reason: string };
export function parseRepairVat(data: Json | null | undefined): RepairVatResult {
  const o = isObj(data) ? data : {};
  if (bool(o, "ok") === true) return { ok: true, mode: str(o, "mode") === "mva_utledet" ? "mva_utledet" : "linjer_skalert", lines: num(o, "lines") ?? 0 };
  return { ok: false, reason: str(o, "reason") ?? "ukjent" };
}

export function parseRematchQueued(data: Json | null | undefined): { queued: number; already_queued: number } {
  const o = isObj(data) ? data : {};
  return { queued: num(o, "queued") ?? 0, already_queued: num(o, "already_queued") ?? 0 };
}
