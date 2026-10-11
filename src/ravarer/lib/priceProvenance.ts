/**
 * Historisk prisgrunnlag per prisobservasjon: hvilken enhet, pakning og valuta
 * prisen faktisk gjaldt da den ble registrert. Vi gjetter aldri: uten dokumentert
 * grunnlag er enheten ukjent (null), og raden er ikke sammenlignbar i graf/Δ.
 */

/** Enhetsvakten (`_rm_base_unit_cutoff`) ble satt i drift her; senere enhetsbytter er revidert. */
export const BASE_UNIT_GUARD_SINCE = "2026-10-11T13:19:49Z";

export type UnitSource = "enhetsbytte" | "fakturalinje" | "etter_enhetsvakt";

export const UNIT_SOURCE_LABEL: Record<UnitSource, string> = {
  enhetsbytte: "Revidert enhetsbytte",
  fakturalinje: "Fakturalinjens pris per grunnenhet",
  etter_enhetsvakt: "Registrert etter enhetsvakt",
};

export interface UnitChange {
  at: string;
  old: string | null;
  new: string | null;
}

export interface ProvenanceLine {
  unit: string | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  price_per_base_unit: number | null;
}

export interface CorrectionField {
  field: string;
  before: string;
  after: string;
}

export interface CorrectionSnapshot {
  at: string;
  reason: string | null;
  fields: CorrectionField[];
}

export interface PriceProvenance {
  /** Grunnenheten prisen gjaldt for, eller null når den ikke er dokumentert. */
  unit: string | null;
  unitSource: UnitSource | null;
  /** Pakning fra fakturalinjen, f.eks. «25 kg» / «10 × 1 kg». Null = ukjent. */
  packageText: string | null;
  /** Valuta fra raden (eller fakturaen). Null = ukjent. */
  currency: string | null;
  corrections: CorrectionSnapshot[];
}

export interface ProvenanceInput {
  price: number;
  createdAt: string | null;
  currency: string | null | undefined;
  isLegacy: boolean;
  supersededReason: string | null | undefined;
  line: ProvenanceLine | null;
  invoiceCurrency: string | null;
  currentUnit: string | null;
  unitChanges: readonly UnitChange[];
  corrections?: readonly CorrectionSnapshot[];
}

function fmtNum(n: number): string {
  return n.toLocaleString("nb-NO", { maximumFractionDigits: 4 });
}

export function packageText(line: ProvenanceLine | null): string | null {
  if (!line || line.package_size == null || !(Number(line.package_size) > 0) || !line.package_unit) return null;
  const size = `${fmtNum(Number(line.package_size))} ${line.package_unit}`;
  const count = Number(line.count_per_package);
  return count > 1 ? `${fmtNum(count)} × ${size}` : size;
}

export function resolveUnit(i: ProvenanceInput): { unit: string | null; source: UnitSource | null } {
  const changes = [...i.unitChanges].sort((a, b) => a.at.localeCompare(b.at));
  if (changes.length > 0 && i.createdAt) {
    const after = changes.find((c) => c.at > (i.createdAt as string));
    if (after) return { unit: after.old, source: after.old ? "enhetsbytte" : null };
    const last = changes[changes.length - 1];
    return { unit: last.new, source: last.new ? "enhetsbytte" : null };
  }
  if (i.supersededReason === "enhet_endret" || i.isLegacy) return { unit: null, source: null };
  const pp = Number(i.line?.price_per_base_unit);
  if (i.currentUnit && Number.isFinite(pp) && pp > 0 && i.price > 0 && Math.abs(pp - i.price) / i.price <= 0.005) {
    return { unit: i.currentUnit, source: "fakturalinje" };
  }
  if (i.currentUnit && i.createdAt && i.createdAt >= BASE_UNIT_GUARD_SINCE) {
    return { unit: i.currentUnit, source: "etter_enhetsvakt" };
  }
  return { unit: null, source: null };
}

export function resolveProvenance(i: ProvenanceInput): PriceProvenance {
  const u = resolveUnit(i);
  const cur = (i.currency ?? i.invoiceCurrency ?? "").trim().toUpperCase();
  return {
    unit: u.unit,
    unitSource: u.source,
    packageText: packageText(i.line),
    currency: cur || null,
    corrections: [...(i.corrections ?? [])].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

const CORRECTION_FIELD_LABEL: Record<string, string> = {
  quantity: "Mengde",
  unit_price: "Enhetspris",
  line_total: "Linjesum",
  unit: "Enhet",
  package_size: "Pakningsstørrelse",
  package_unit: "Pakningsenhet",
  count_per_package: "Antall per pakning",
  discount_pct: "Rabatt %",
  unit_price_basis: "Prisgrunnlag",
  description: "Varetekst",
};

export function correctionFieldLabel(field: string): string {
  return CORRECTION_FIELD_LABEL[field] ?? field;
}

function scalar(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Leser `invoice_line_corrections` (original/corrected/changed_fields) til før/etter-par. */
export function parseCorrection(row: {
  corrected_at: string;
  reason: string | null;
  changed_fields: string[] | null;
  original: unknown;
  corrected: unknown;
}): CorrectionSnapshot {
  const o = row.original && typeof row.original === "object" && !Array.isArray(row.original) ? (row.original as Record<string, unknown>) : {};
  const c = row.corrected && typeof row.corrected === "object" && !Array.isArray(row.corrected) ? (row.corrected as Record<string, unknown>) : {};
  const fields = (row.changed_fields ?? []).map((f) => ({ field: correctionFieldLabel(f), before: scalar(o[f]), after: scalar(c[f]) }));
  return { at: row.corrected_at, reason: row.reason, fields };
}

export function correctionText(c: CorrectionSnapshot): string {
  return c.fields.map((f) => `${f.field}: ${f.before} → ${f.after}`).join(", ");
}
