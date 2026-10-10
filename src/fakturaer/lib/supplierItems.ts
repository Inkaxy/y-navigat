import { REASON_LABELS, type ReasonCode } from "@/fakturaer/lib/reviewReasons";
import type { StatusTone } from "@/fakturaer/lib/lineStatus";

export const SUPPLIER_ITEM_STATUSES = ["ukoblet", "mangler_pakning", "prisavvik", "kontroll", "koblet", "ikke_vare"] as const;
export type SupplierItemStatus = (typeof SUPPLIER_ITEM_STATUSES)[number];

export const SUPPLIER_ITEM_STATUS_META: Record<SupplierItemStatus, { label: string; tone: StatusTone }> = {
  ukoblet: { label: "Ukoblet", tone: "danger" },
  mangler_pakning: { label: "Mangler pakning", tone: "warning" },
  prisavvik: { label: "Prisavvik", tone: "warning" },
  kontroll: { label: "Kontroll", tone: "warning" },
  koblet: { label: "Koblet", tone: "success" },
  ikke_vare: { label: "Ikke vare", tone: "muted" },
};

export function isSupplierItemStatus(v: string | null | undefined): v is SupplierItemStatus {
  return !!v && (SUPPLIER_ITEM_STATUSES as readonly string[]).includes(v);
}

export interface SupplierItem {
  supplier_id: string;
  supplier_name: string | null;
  item_key: string;
  supplier_sku: string | null;
  description: string | null;
  line_count: number;
  invoice_count: number;
  first_seen: string | null;
  last_seen: string | null;
  open_lines: number;
  last_line_id: string | null;
  last_invoice_id: string | null;
  last_invoice_date: string | null;
  linked_rm_id: string | null;
  rm_id: string | null;
  rm_name: string | null;
  rm_sku: string | null;
  rm_base_unit: string | null;
  rm_category: string | null;
  rm_cost: number | null;
  rms_id: string | null;
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  package_confirmed_at: string | null;
  agreed_price_per_base_unit: number | null;
  is_primary: boolean | null;
  variants: number | null;
  last_ppbu: number | null;
  prev_ppbu: number | null;
  last_conf: string | null;
  reasons_raw: string | null;
  status: SupplierItemStatus;
}

export type SupplierItemCounts = Record<SupplierItemStatus, number>;

export interface SupplierItemsResult {
  total: number;
  counts: SupplierItemCounts;
  items: SupplierItem[];
}

export interface SupplierItemLine {
  id: string;
  invoice_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_status: string | null;
  flagged_at: string | null;
  is_credit_note: boolean | null;
  reconciled_mode: string | null;
  line_number: number | null;
  supplier_sku: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  base_quantity: number | null;
  price_per_base_unit: number | null;
  expected_price_per_base_unit: number | null;
  price_variance_pct: number | null;
  variance_status: string | null;
  price_reference_source: string | null;
  raw_material_id: string | null;
  raw_material_name: string | null;
  match_confidence: string | null;
  requires_review: boolean | null;
  review_reason: string | null;
  resolution_note: string | null;
  created_at: string | null;
  line_kind: string | null;
  cost_posted: boolean | null;
  in_price_history: boolean | null;
}

export interface PackageInference {
  ok: boolean;
  base_unit: string | null;
  line_unit: string | null;
  arithmetic: { bupp: number | null; raw: number | null; ok: boolean } | null;
  description: { count: number | null; size: number | null; unit: string | null; total: number | null; bupp: number | null } | null;
  agrees: boolean;
  suggested_bupp: number | null;
  source: "regnestykke_og_varenavn" | "regnestykke" | "varenavn" | null;
  auto_confirmable: boolean;
  explanation: string;
}

export interface LinkSupplierItemBody {
  legal_entity_id: string;
  supplier_id: string;
  item_key: string;
  raw_material_id?: string;
  new_raw_material?: { name: string; base_unit: string; category?: string; item_type?: string; sku?: string; declaration_name?: string };
  package?: { package_size?: number; package_unit?: string; base_units_per_package?: number; confirm?: boolean };
  set_primary?: boolean;
  not_raw_material?: boolean;
  reason?: string;
  line_ids?: string[];
}

export interface LinkSupplierItemResult {
  ok: boolean;
  mode: "koblet" | "ikke_vare";
  raw_material_id: string | null;
  raw_material_supplier_id: string | null;
  created_raw_material: boolean;
  lines_updated: number;
  invoices: {
    invoice_id: string;
    invoice_number: string | null;
    status: string | null;
    reconciled_mode: string | null;
    rematched: boolean;
    requires_review_count: number;
    review_reasons: string[];
    auto_reconcile: boolean;
  }[];
  still_open_lines: number;
  failures: { invoice_id: string; reason: string }[];
}

export const EMPTY_COUNTS: SupplierItemCounts = { ukoblet: 0, mangler_pakning: 0, prisavvik: 0, kontroll: 0, koblet: 0, ikke_vare: 0 };

export function reasonText(code: string): string {
  const c = code.trim();
  return c in REASON_LABELS ? REASON_LABELS[c as ReasonCode] : "Annen årsak";
}

/** Distinkte, norske årsaker fra en kommaseparert liste. */
export function reasonLabelsOf(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const c = part.trim();
    if (!c) continue;
    const l = reasonText(c);
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

/** Maks to årsaker + «+N». */
export function reasonSummary(raw: string | null | undefined, max = 2): string[] {
  const all = reasonLabelsOf(raw);
  return all.length > max ? [...all.slice(0, max), `+${all.length - max}`] : all;
}

export const LINE_KIND_LABEL: Record<string, string> = {
  vare: "Vare",
  pant: "Pant",
  frakt: "Frakt",
  gebyr: "Gebyr",
  rabatt: "Rabatt",
  avrunding: "Avrunding",
  mva: "Mva",
  annet: "Annet",
};
export const lineKindLabel = (k: string | null | undefined) => (k ? LINE_KIND_LABEL[k] ?? "Annet" : null);

export function pctChange(last: number | null, prev: number | null): number | null {
  if (last == null || prev == null || !Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((last - prev) / prev) * 100;
}

const fmt = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 3 });

export function packageText(i: Pick<SupplierItem, "base_units_per_package" | "rm_base_unit" | "package_unit" | "package_confirmed_at" | "rm_id">): string {
  if (!i.rm_id) return "—";
  if (i.base_units_per_package == null) return "mangler";
  const per = i.package_unit ? ` per ${i.package_unit}` : "";
  return `${fmt(i.base_units_per_package)} ${i.rm_base_unit ?? ""}${per} · ${i.package_confirmed_at ? "bekreftet" : "ubekreftet"}`.replace(/\s+/g, " ");
}

/** Klartekst om hva som mangler for varekortet. */
export function whatIsMissing(i: SupplierItem): string {
  const n = i.open_lines;
  const lines = `${n} ${n === 1 ? "linje" : "linjer"}`;
  const rm = i.rm_name ?? "en råvare";
  switch (i.status) {
    case "ukoblet":
      return `Varen er ikke koblet til en råvare — derfor kan ikke kostprisen føres på ${lines}.`;
    case "mangler_pakning":
      return `Varen er koblet til ${rm}, men pakningen er ikke bekreftet — derfor kan ikke ${i.rm_base_unit ? `prisen per ${i.rm_base_unit}` : "prisen per grunnenhet"} regnes ut på ${lines}.`;
    case "prisavvik":
      return `Varen er koblet til ${rm}, men prisen avviker fra prisgrunnlaget på ${lines}. Avklar avviket i fakturakontrollen.`;
    case "kontroll":
      return `Varen er koblet til ${rm}, men ${lines} står til kontroll: ${reasonLabelsOf(i.reasons_raw).join(", ").toLowerCase() || "annen årsak"}.`;
    case "ikke_vare":
      return "Varen er merket som ikke en vare, og nye linjer utelates automatisk.";
    default:
      return `Varen er koblet til ${rm} og har ingen åpne linjer.`;
  }
}

/** Norsk oppsummering av resultatet fra koblingen. */
export function linkResultSummary(r: LinkSupplierItemResult): string[] {
  const inv = r.invoices.length;
  const auto = r.invoices.filter((x) => x.auto_reconcile || x.reconciled_mode === "auto").length;
  const out = [
    r.mode === "ikke_vare"
      ? `${r.lines_updated} ${r.lines_updated === 1 ? "linje" : "linjer"} merket som ikke vare på ${inv} ${inv === 1 ? "faktura" : "fakturaer"}.`
      : `${r.lines_updated} ${r.lines_updated === 1 ? "linje" : "linjer"} koblet på ${inv} ${inv === 1 ? "faktura" : "fakturaer"}.`,
  ];
  if (auto > 0) out.push(`${auto} ${auto === 1 ? "faktura ble" : "fakturaer ble"} avstemt automatisk.`);
  if (r.still_open_lines > 0) {
    const counts = new Map<string, number>();
    r.invoices.forEach((x) => x.review_reasons.forEach((c) => counts.set(reasonText(c).toLowerCase(), (counts.get(reasonText(c).toLowerCase()) ?? 0) + 1)));
    const detail = [...counts].map(([k, v]) => `${k} (${v})`).join(", ");
    out.push(`${r.still_open_lines} ${r.still_open_lines === 1 ? "linje står" : "linjer står"} fortsatt til kontroll${detail ? `: ${detail}` : ""}.`);
  }
  return out;
}
