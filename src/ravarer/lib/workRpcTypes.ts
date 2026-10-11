import type { ActionRequired } from "@/fakturaer/lib/financialPresentation";
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
  amount: number;
  /** Prisvirkning. Null = ikke beregnet (gammel server eller usikker lesing) — aldri bruttobeløp. */
  impact_nok: number | null;
  last_date: string | null; last_open_line_id: string | null; reasons: string[];
  /** Fravær = «unknown»: eldre servere har ikke feltet og vises konservativt. */
  effect_status: WorkEffectStatus;
  effect_label: string | null;
  read_integrity: ReadIntegrity;
  read_integrity_flags: string[];
  unknown_effect_lines: number | null;
  amount_kind: string | null;
  /** Serverens neste kontrollhandling (rm_work_items.action_required); null = eldre server. */
  action_required: ActionRequired | null;
};

export const WORK_EFFECT_STATUSES = ["verified_price_effect", "unknown", "not_price_effect"] as const;
export type WorkEffectStatus = (typeof WORK_EFFECT_STATUSES)[number];
export const READ_INTEGRITY = ["checked", "needs_review", "unknown"] as const;
export type ReadIntegrity = (typeof READ_INTEGRITY)[number];

export type WorkItemsCounts = Record<WorkGroup | "faktura_mangler_linjer" | "faktura_sumavvik" | "faktura_flagget" | "faktura_klar", number>;
export type WorkItemsResult = { total: number; counts: WorkItemsCounts; items: WorkItem[]; generated_at: string | null };

export const ACTIVITY_KINDS = [
  "faktura_avstemt_auto", "faktura_avstemt", "faktura_gjenapnet", "mva_rettet", "kostpris_fort",
  "pakning_bekreftet_auto", "priser_karantene", "pris_godtatt", "kobling_bekreftet", "ikke_vare",
  "forste_pris", "gjentatt_pris", "annet",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
/** Ukjente hendelsestyper fra serveren vises som «annet» med nøytral etikett. */
export function toActivityKind(v: string | null | undefined): ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(v ?? "") ? (v as ActivityKind) : "annet";
}
export type ActivityItem = {
  id: string; at: string; kind: ActivityKind; actor: "system" | "bruker"; user_name: string | null;
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

/** Konservative standardverdier når serveren ikke sender effektfeltene. */
export const WORK_ITEM_EFFECT_DEFAULTS = {
  effect_status: "unknown", effect_label: null, read_integrity: "unknown", read_integrity_flags: [], unknown_effect_lines: null, amount_kind: null, action_required: null,
} as const satisfies Pick<WorkItem, "effect_status" | "effect_label" | "read_integrity" | "read_integrity_flags" | "unknown_effect_lines" | "amount_kind" | "action_required">;
