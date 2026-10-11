/**
 * Autoritativ prisstatus per fakturalinje fra `rm_invoice_line_price_safety` (live, se
 * supabase/live-mirror/20261011162824_invoice_line_authoritative_price_safety.md).
 * Klienten sertifiserer aldri selv: manglende, ugyldig, gammel eller feilet status er ukjent.
 */
import type { Json } from "@/integrations/supabase/types";
import { ACTION_COPY, type ActionRequired, type PriceGate } from "./financialPresentation";

export type ReferenceSource = "agreement" | "last_purchase" | "start_price";
export type LineSafety = {
  line_id: string;
  line_version: string | null;
  raw_material_id: string | null;
  can_compare: boolean;
  effect_nok: number | null;
  reason_code: string | null;
  reference_source: ReferenceSource | null;
  reference_id: string | null;
  expected_price_per_base_unit: number | null;
  price_per_base_unit: number | null;
  base_quantity: number | null;
};
export type InvoiceSafety = { invoice_id: string; checked_at: string; lines: Map<string, LineSafety> };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const numOrNull = (v: unknown): number | null | "bad" => (v == null ? null : typeof v === "number" && Number.isFinite(v) ? v : "bad");
const strOrNull = (v: unknown): string | null | "bad" => (v == null ? null : typeof v === "string" ? v : "bad");
const REFS: ReferenceSource[] = ["agreement", "last_purchase", "start_price"];

function parseLine(v: unknown): LineSafety | null {
  if (!isRec(v) || typeof v.line_id !== "string" || typeof v.can_compare !== "boolean") return null;
  const nums = ["effect_nok", "expected_price_per_base_unit", "price_per_base_unit", "base_quantity"].map((k) => numOrNull(v[k]));
  const strs = ["line_version", "raw_material_id", "reason_code", "reference_id"].map((k) => strOrNull(v[k]));
  if (nums.includes("bad") || strs.includes("bad")) return null;
  const ref = v.reference_source == null ? null : typeof v.reference_source === "string" && (REFS as string[]).includes(v.reference_source) ? (v.reference_source as ReferenceSource) : "bad";
  if (ref === "bad") return null;
  const [effect, expected, ppbu, bq] = nums as (number | null)[];
  const [version, rm, reason, refId] = strs as (string | null)[];
  // Godkjent krever endelig, ikke-negativ virkning; ellers er linjen ukjent.
  if (v.can_compare && (effect == null || effect < 0)) return null;
  return {
    line_id: v.line_id, line_version: version, raw_material_id: rm, can_compare: v.can_compare, effect_nok: v.can_compare ? effect : null,
    reason_code: reason, reference_source: v.can_compare ? ref : null, reference_id: v.can_compare ? refId : null,
    expected_price_per_base_unit: v.can_compare ? expected : null, price_per_base_unit: v.can_compare ? ppbu : null, base_quantity: v.can_compare ? bq : null,
  };
}

/** Svar → status per linje. Feil faktura-ID eller ugyldig form gir null (alt ukjent). Ugyldige linjer utelates (= ukjent). */
export function parsePriceSafety(data: Json | unknown, invoiceId: string): InvoiceSafety | null {
  if (!isRec(data) || data.invoice_id !== invoiceId || !Array.isArray(data.lines)) return null;
  const lines = new Map<string, LineSafety>();
  for (const l of data.lines) { const p = parseLine(l); if (p) lines.set(p.line_id, p); }
  return { invoice_id: invoiceId, checked_at: typeof data.checked_at === "string" ? data.checked_at : "", lines };
}

const REASONS: Record<string, { label: string; action: ActionRequired; detail?: string }> = {
  credit_note: { label: "Kreditnota – ikke sammenlignbar varepris", action: "review_credit_note" },
  non_nok_currency: { label: "Valuta må avklares før NOK-sammenligning", action: "review_currency" },
  cancelled_invoice: { label: "Fakturaen er annullert", action: "review_invoice", detail: "En annullert faktura sammenlignes ikke med priser." },
  invoice_status_unverified: { label: "Fakturastatus må avklares", action: "review_invoice" },
  invoice_read_unverified: { label: "Kontroller fakturalesingen", action: "review_reading" },
  invoice_sum_not_verified: { label: "Kontroller fakturasummen", action: "review_reading" },
  line_arithmetic_unverified: { label: "Kontroller linjebeløp og mengde", action: "review_reading" },
  invalid_quantity: { label: "Kontroller linjebeløp og mengde", action: "review_reading" },
  missing_link: { label: "Avklar varekobling og linje", action: "complete_link_or_package" },
  invalid_tenant_link: { label: "Avklar varekobling og linje", action: "complete_link_or_package" },
  line_needs_review: { label: "Avklar varekobling og linje", action: "complete_link_or_package" },
  package_not_confirmed: { label: "Avklar pakning og mengdegrunnlag", action: "complete_link_or_package" },
  package_snapshot_missing: { label: "Avklar pakning og mengdegrunnlag", action: "complete_link_or_package" },
  package_snapshot_conflicts: { label: "Avklar pakning og mengdegrunnlag", action: "complete_link_or_package" },
  base_quantity_conflicts: { label: "Avklar pakning og mengdegrunnlag", action: "complete_link_or_package" },
  price_observation_held: { label: "Prisgrunnlaget er til kontroll", action: "confirm_price_basis" },
  price_reference_unverified: { label: "Sammenligningsprisen må avklares", action: "confirm_price_basis" },
};

export const UNCHECKED: PriceGate = { ok: false, reason: "unchecked", action: "confirm_price_basis", label: "Prisgrunnlag ikke kontrollert", detail: "Prisstatusen er ikke hentet, feilet eller er utdatert. Prisvirkning vises ikke." };

export function reasonGate(code: string | null): PriceGate {
  const r = code ? REASONS[code] : undefined;
  if (!r) return { ok: false, reason: code ?? "unknown", action: "confirm_price_basis", label: "Kan ikke sammenligne pris ennå", detail: "Prisvirkning vises ikke før prisgrunnlaget er kontrollert." };
  return { ok: false, reason: code ?? "unknown", action: r.action, label: r.label, detail: r.detail ?? ACTION_COPY[r.action].detail };
}

/**
 * Status for én linje. `fresh=false` (lasting/feil/oppdatering/ventende endring) gir alltid ukjent.
 * Linjeversjon må stemme med lastet linje når den er kjent.
 */
export function safetyGate(entry: LineSafety | undefined, fresh: boolean, loadedVersion?: string | null): PriceGate {
  if (!fresh || !entry) return UNCHECKED;
  if (loadedVersion != null && entry.line_version != null && Date.parse(loadedVersion) !== Date.parse(entry.line_version)) return UNCHECKED;
  if (!entry.can_compare) return reasonGate(entry.reason_code);
  return { ok: true, safety: entry };
}

/** Sum av virkning bare når HVER bidragende linje er fersk og godkjent; ellers null. 0 = kontrollert uten avvik. */
export function totalEffect(gates: PriceGate[]): number | null {
  if (gates.length === 0) return null;
  let s = 0;
  for (const g of gates) { if (!g.ok) return null; s += g.safety.effect_nok ?? Number.NaN; }
  return Number.isFinite(s) ? Math.round(s * 100) / 100 : null;
}

/** Retning bare fra verifiserte enhetspriser. */
export function priceDirection(s: LineSafety): "up" | "down" | "same" | null {
  const a = s.price_per_base_unit, e = s.expected_price_per_base_unit;
  if (a == null || e == null) return null;
  return Math.abs(a - e) < 1e-9 ? "same" : a > e ? "up" : "down";
}

export const PRICE_SAFETY_KEY = "invoice-line-price-safety" as const;
