/** Typer for arbeidsoppslagene i Råvarer 2.0 (rm_work_summary, rm_work_items, …). */

export type SupplierItemCounts = {
  koblet: number; ukoblet: number; mangler_pakning: number; prisavvik: number; kontroll: number; ikke_vare: number;
};

export type InvoiceCounts = {
  open_total: number; missing_lines: number; sum_mismatch: number; needs_review: number; ready_to_reconcile: number;
  credit_notes_open: number; flagged: number; reconciled_total: number; reconciled_auto: number;
  reconciled_7d: number; reconciled_auto_7d: number; imported_7d: number;
};

export type DataQualityCounts = {
  missing_package: number; unconfirmed_package: number; unstable_price: number; missing_declaration: number;
  missing_nutrition: number; datasheet_changes: number; active_items: number;
};

export type WorkSummary = {
  invoice_access: boolean;
  supplier_items: SupplierItemCounts | null;
  invoices: InvoiceCounts | null;
  lines_to_review: number | null;
  approval: { ready_to_approve: number; approved_total: number } | null;
  data_quality: DataQualityCounts;
  other: {
    cases_open: number | null; agreements_expiring_90d: number; agreements_expiring_30d: number;
    stock_below_min: number; rematch_pending: number | null;
  };
  todo_total: number | null;
  generated_at: string | null;
};

export const WORK_GROUPS = ["alle", "kobling", "pakning", "pris", "kontroll", "fakturaer"] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
export type WorkItemGroup = Exclude<WorkGroup, "alle">;
export const WORK_KINDS = [
  "ukoblet", "mangler_pakning", "prisavvik", "kontroll",
  "faktura_mangler_linjer", "faktura_sumavvik", "faktura_flagget", "faktura_klar",
] as const;
export type WorkItemKind = (typeof WORK_KINDS)[number];
export type WorkSort = "impact" | "frequency" | "newest";

export type WorkItem = {
  key: string; grp: WorkItemGroup; type: "varekort" | "faktura"; kind: WorkItemKind;
  supplier_id: string | null; supplier_name: string | null; item_key: string | null;
  invoice_id: string | null; invoice_number: string | null; title: string; sku: string | null;
  rm_id: string | null; rm_name: string | null; open_lines: number; open_invoices: number; invoice_count: number;
  amount: number; impact_nok: number; last_date: string | null; last_open_line_id: string | null; reasons: string[];
};

export type WorkItemsCounts = Record<WorkGroup | "faktura_mangler_linjer" | "faktura_sumavvik" | "faktura_flagget" | "faktura_klar", number>;
export type WorkItemsResult = { total: number; counts: WorkItemsCounts; items: WorkItem[]; generated_at: string | null };

export const ACTIVITY_KINDS = [
  "faktura_avstemt_auto", "faktura_avstemt", "faktura_gjenapnet", "mva_rettet", "kostpris_fort",
  "pakning_bekreftet_auto", "priser_karantene", "pris_godtatt", "kobling_bekreftet", "ikke_vare",
  "forste_pris", "gjentatt_pris",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ActivityItem = {
  id: string; at: string; kind: ActivityKind | string; actor: "system" | "bruker"; user_name: string | null;
  title: string; subject: string | null; detail: string | null; invoice_id: string | null;
  raw_material_id: string | null; count: number;
};
export type ActivityFeed = { since: string | null; items: ActivityItem[]; summary: Record<string, number>; generated_at: string | null };

export type PriceMover = {
  raw_material_id: string; rm_name: string; base_unit: string | null; supplier_id: string | null; supplier_name: string | null;
  before_price: number | null; before_date: string | null; now_price: number | null; now_date: string | null;
  change_pct: number | null; quantity: number | null; effect_nok: number | null; suspicious: boolean;
  points: { date: string; price: number }[];
};
export type PriceMovers = {
  days: number; from: string | null; items: PriceMover[];
  summary: { changed: number; up: number; down: number; suspicious: number; effect_nok: number; effect_up_nok: number; effect_down_nok: number };
  generated_at: string | null;
};

export const ACCEPT_SKIP_REASONS = ["andre_arsaker", "endret", "faktura_last", "ikke_koblet", "mangler_prisgrunnlag", "feil"] as const;
export type AcceptSkipReason = (typeof ACCEPT_SKIP_REASONS)[number];
export type AcceptPriceResult = {
  ok: boolean; error: string | null; accepted: number; skipped: number;
  accepted_lines: { id: string; invoice_id: string | null; invoice_number: string | null }[];
  skipped_lines: { id: string; invoice_number: string | null; reason: AcceptSkipReason; message: string }[];
  invoices: string[];
  rematch: { ok: boolean; queued: number; already_queued: number; pending: number } | null;
};
