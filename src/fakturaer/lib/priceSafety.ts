/**
 * Autoritativ prisstatus per fakturalinje fra `rm_invoice_line_price_safety` (live, se
 * supabase/live-mirror/20261011162824_invoice_line_authoritative_price_safety.md).
 * Klienten sertifiserer aldri selv: manglende, ugyldig, gammel eller feilet status er ukjent.
 */
import type { Json } from "@/integrations/supabase/types";
import { ACTION_COPY, type ActionRequired, type PriceGate } from "./financialPresentation";

export type ReferenceSource = "agreement" | "last_purchase" | "start_price";
export type BaseUnit = "kg" | "g" | "l" | "ml" | "stk";
export type LineSafety = {
  line_id: string;
  line_version: string | null;
  raw_material_id: string | null;
  can_compare: boolean;
  effect_nok: number | null;
  reason_code: string | null;
  reference_source: ReferenceSource | null;
  reference_id: string | null;
  /** Fra serverens gjeldende referanse (schema 2). Null = udatert gyldig grunnlag, aldri «i dag». */
  reference_date: string | null;
  base_unit: BaseUnit | null;
  currency: "NOK" | null;
  expected_price_per_base_unit: number | null;
  price_per_base_unit: number | null;
  base_quantity: number | null;
};
export type InvoiceSafety = {
  invoice_id: string;
  legal_entity_id: string;
  checked_at: string;
  lines: Map<string, LineSafety>;
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const numOrNull = (v: unknown): number | null | "bad" => (v == null ? null : typeof v === "number" && Number.isFinite(v) ? v : "bad");
const strOrNull = (v: unknown): string | null | "bad" => (v == null ? null : typeof v === "string" ? v : "bad");
const REFS: ReferenceSource[] = ["agreement", "last_purchase", "start_price"];
export const COMPARABLE_UNITS: readonly BaseUnit[] = ["kg", "g", "l", "ml", "stk"];
const nonEmpty = (v: string | null): v is string => typeof v === "string" && v.trim() !== "";

/** Ekte kalenderdato (YYYY-MM-DD, evt. med klokkeslett). Ugyldig = "bad". */
function isoDateOrNull(v: unknown): string | null | "bad" {
  if (v == null) return null;
  if (typeof v !== "string") return "bad";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v);
  if (!m) return "bad";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? v.slice(0, 10) : "bad";
}

/**
 * PostgreSQL-tidsstempel → sammenlignbar nøkkel med full mikrosekundpresisjon i UTC.
 * `Date.parse` alene mister mikrosekunder. Mangler sone eller er formen ugyldig: null.
 */
export function versionKey(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se, frac = "", tz] = m;
  const Y = Number(y), Mo = Number(mo), D = Number(d), H = Number(h), Mi = Number(mi), S = Number(se);
  // Streng validering: Date.UTC normaliserer ellers 30. feb, 24:00, minutt 60 og år 00–99 stille.
  if (Mo < 1 || Mo > 12 || D < 1 || H > 23 || Mi > 59 || S > 59) return null;
  const leap = (Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Mo - 1];
  if (D > dim) return null;
  let off = 0;
  if (tz !== "Z") {
    const t = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(tz);
    if (!t) return null;
    const oh = Number(t[2]), om = Number(t[3] ?? "0");
    if (oh > 15 || om > 59) return null;
    off = (t[1] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  const dt = new Date(0);
  dt.setUTCFullYear(Y, Mo - 1, D);
  dt.setUTCHours(H, Mi, S, 0);
  const ms = dt.getTime() - off * 60_000;
  if (!Number.isFinite(ms)) return null;
  return `${ms / 1000}.${frac.padEnd(6, "0")}`;
}

function parseLine(v: unknown): LineSafety | null {
  if (!isRec(v) || typeof v.line_id !== "string" || v.line_id === "" || typeof v.can_compare !== "boolean") return null;
  const nums = ["effect_nok", "expected_price_per_base_unit", "price_per_base_unit", "base_quantity"].map((k) => numOrNull(v[k]));
  const strs = ["line_version", "raw_material_id", "reason_code", "reference_id", "base_unit", "currency"].map((k) => strOrNull(v[k]));
  const refDate = isoDateOrNull(v.reference_date);
  if (nums.includes("bad") || strs.includes("bad") || refDate === "bad") return null;
  const ref = v.reference_source == null ? null : typeof v.reference_source === "string" && (REFS as string[]).includes(v.reference_source) ? (v.reference_source as ReferenceSource) : "bad";
  if (ref === "bad") return null;
  const [effect, expected, ppbu, bq] = nums as (number | null)[];
  const [version, rm, reason, refId, unit, currency] = strs as (string | null)[];
  if (!v.can_compare) {
    return { line_id: v.line_id, line_version: version, raw_material_id: rm, can_compare: false, effect_nok: null, reason_code: reason,
      reference_source: null, reference_id: null, reference_date: null, base_unit: null, currency: null,
      expected_price_per_base_unit: null, price_per_base_unit: null, base_quantity: null };
  }
  // Godkjent krever komplett, gyldig kvittering. Ett manglende felt = ukjent (linjen utelates), aldri delvis godkjent.
  const unitOk = unit != null && (COMPARABLE_UNITS as readonly string[]).includes(unit);
  const pos = (x: number | null): x is number => x != null && x > 0;
  if (!nonEmpty(version) || !nonEmpty(rm) || !nonEmpty(refId) || ref == null || !unitOk || currency !== "NOK" || reason != null
    || !pos(ppbu) || !pos(expected) || !pos(bq) || effect == null || effect < 0) return null;
  return {
    line_id: v.line_id, line_version: version, raw_material_id: rm, can_compare: true, effect_nok: effect, reason_code: null,
    reference_source: ref, reference_id: refId, reference_date: refDate, base_unit: unit as BaseUnit, currency: "NOK",
    expected_price_per_base_unit: expected, price_per_base_unit: ppbu, base_quantity: bq,
  };
}

/**
 * Svar (schema 2) → status per linje. Feil faktura, manglende selskap, ugyldig tidspunkt eller
 * duplikate linje-ID-er gir null (alt ukjent). Ugyldige linjer utelates (= ukjent).
 */
export function parsePriceSafety(data: Json | unknown, invoiceId: string, expectedEntityId?: string | null): InvoiceSafety | null {
  if (!isRec(data) || data.schema_version !== 2 || data.invoice_id !== invoiceId || !Array.isArray(data.lines)) return null;
  if (typeof data.legal_entity_id !== "string" || data.legal_entity_id === "") return null;
  if (expectedEntityId !== undefined && data.legal_entity_id !== expectedEntityId) return null;
  if (typeof data.checked_at !== "string" || !Number.isFinite(Date.parse(data.checked_at))) return null;
  const lines = new Map<string, LineSafety>();
  const seen = new Set<string>();
  for (const l of data.lines) {
    if (isRec(l) && typeof l.line_id === "string") {
      if (seen.has(l.line_id)) return null;
      seen.add(l.line_id);
    }
    const p = parseLine(l);
    if (p) lines.set(p.line_id, p);
  }
  return { invoice_id: invoiceId, legal_entity_id: data.legal_entity_id, checked_at: data.checked_at, lines };
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

/** Den faktiske raden som skal vise status. `undefined` = ikke kjent fra kallstedet. */
export type CallerBinding = { updated_at?: string | null; raw_material_id?: string | null };

/**
 * Status for én linje. `fresh=false` (lasting/feil/oppdatering/utløpt/ventende endring) gir alltid ukjent.
 * Godkjent krever at kvitteringen gjelder nøyaktig samme radversjon (full presisjon) og råvare som
 * kallerens egen rad. Kjent, men ulik eller manglende versjon = ukjent.
 */
export function safetyGate(entry: LineSafety | undefined, fresh: boolean, caller?: CallerBinding | string | null): PriceGate {
  if (!fresh || !entry) return UNCHECKED;
  if (!entry.can_compare) return reasonGate(entry.reason_code);
  const b: CallerBinding = typeof caller === "string" || caller == null ? { updated_at: caller ?? null } : caller;
  const mine = versionKey(b.updated_at ?? null);
  if (mine == null || mine !== versionKey(entry.line_version)) return UNCHECKED;
  if (b.raw_material_id !== undefined && b.raw_material_id !== entry.raw_material_id) return UNCHECKED;
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

/**
 * Presisering for én linje uten å endre serverens svar: `invalid_quantity` på en linje med gyldig
 * mengde men uten grunnmengde betyr at mengden ikke kan regnes om (pakning/grunnenhet), ikke at
 * tallene er lest feil. Bare da flyttes handlingen til pakningssteget; alt annet er uendret.
 */
export function refineGateForLine(
  gate: PriceGate,
  l: { quantity: number | null; base_quantity: number | null },
  localReadIssue: boolean,
): PriceGate {
  if (gate.ok || gate.reason !== "invalid_quantity" || localReadIssue) return gate;
  if (l.base_quantity != null || l.quantity == null || !(Number(l.quantity) > 0)) return gate;
  return { ...gate, action: "complete_link_or_package", label: "Avklar pakning og mengdegrunnlag", detail: "Mengden kan ikke regnes om til varens grunnenhet før pakningen (og eventuelt varetype/grunnenhet) er avklart. Tallene på linjen er ikke underkjent." };
}
