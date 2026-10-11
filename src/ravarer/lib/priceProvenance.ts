/**
 * Historisk prisgrunnlag per prisobservasjon: hvilken enhet, pakning og valuta
 * prisen faktisk gjaldt da den ble registrert. Vi gjetter aldri: uten dokumentert
 * grunnlag er enheten ukjent (null), og raden er ikke sammenlignbar i graf/Δ.
 */

/**
 * `currently_verified_line` er IKKE et låst historisk grunnlag: serveren (`rm_material_price_projection`)
 * har kontrollert nå at den koblede fakturalinjen støtter prisen i denne enheten. Skrives aldri tilbake.
 */
export type UnitSource = "ved_registrering" | "revidert_enhetsbytte" | "currently_verified_line";

export const UNIT_SOURCE_LABEL: Record<UnitSource, string> = {
  ved_registrering: "Låst ved registrering",
  revidert_enhetsbytte: "Revidert enhetsbytte",
  currently_verified_line: "Kontrollert fra fakturalinje",
};

/** Forklaring som alltid følger en rekonstruert rad. */
export const RECONSTRUCTED_NOTE = "Kontrollert nå — originalt enhetsgrunnlag var ikke låst";

/** Pakning slik den var på fakturalinjen da prisen ble registrert (`snapshot_package`). */
export interface PackageSnapshot {
  line_unit: string | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  base_units_per_package: number | null;
  line_version: string | null;
  correction_id: string | null;
}

export interface CorrectionField {
  field: string;
  before: string;
  after: string;
}

export interface CorrectionSnapshot {
  id?: string | null;
  at: string;
  reason: string | null;
  fields: CorrectionField[];
}

export interface PriceProvenance {
  /** Grunnenheten prisen gjaldt for, eller null når den ikke er dokumentert. */
  unit: string | null;
  unitSource: UnitSource | null;
  /** Pakning ved registrering, f.eks. «25 kg» / «10 × 1 kg». Null = ukjent. */
  packageText: string | null;
  /** Valuta ved registrering. Null = ukjent. */
  currency: string | null;
  /** Rettelser av kildelinjen; `afterSnapshot` = gjort etter at prisen ble låst. */
  corrections: (CorrectionSnapshot & { afterSnapshot: boolean })[];
}

/**
 * Bare lagret grunnlag teller. Dagens råvareenhet, dagens fakturalinje, prislikhet eller
 * et tidspunkt er ikke bevis for hvilken enhet en gammel pris gjaldt.
 */
export interface ProvenanceInput {
  snapshotUnit: string | null;
  snapshotPackage: unknown;
  snapshotCurrency: string | null;
  snapshotSource: string | null;
  snapshotAt: string | null;
  /** Radens egen lagrede valuta (skrevet sammen med prisen). */
  currency: string | null | undefined;
  corrections?: readonly CorrectionSnapshot[];
}

function fmtNum(n: number): string {
  return n.toLocaleString("nb-NO", { maximumFractionDigits: 4 });
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const t = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function parsePackageSnapshot(v: unknown): PackageSnapshot | null {
  const o = rec(v);
  if (!o) return null;
  return {
    line_unit: t(o.line_unit), package_size: n(o.package_size), package_unit: t(o.package_unit),
    count_per_package: n(o.count_per_package), base_units_per_package: n(o.base_units_per_package),
    line_version: t(o.line_version), correction_id: t(o.correction_id),
  };
}

export function packageText(p: PackageSnapshot | null): string | null {
  if (!p || p.package_size == null || !(p.package_size > 0) || !p.package_unit) return null;
  const size = `${fmtNum(p.package_size)} ${p.package_unit}`;
  const count = Number(p.count_per_package);
  return count > 1 ? `${fmtNum(count)} × ${size}` : size;
}

function unitSource(s: string | null): UnitSource | null {
  return s === "ved_registrering" || s === "revidert_enhetsbytte" ? s : null;
}

export function resolveProvenance(i: ProvenanceInput): PriceProvenance {
  const src = unitSource(i.snapshotSource);
  const unit = src && i.snapshotUnit ? i.snapshotUnit : null;
  const cur = (i.snapshotCurrency ?? i.currency ?? "").trim().toUpperCase();
  return {
    unit,
    unitSource: unit ? src : null,
    packageText: src === "ved_registrering" ? packageText(parsePackageSnapshot(i.snapshotPackage)) : null,
    currency: cur || null,
    corrections: [...(i.corrections ?? [])]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((c) => ({ ...c, afterSnapshot: !!i.snapshotAt && c.at > i.snapshotAt })),
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
  id?: string | null;
  corrected_at: string;
  reason: string | null;
  changed_fields: string[] | null;
  original: unknown;
  corrected: unknown;
}): CorrectionSnapshot {
  const o = row.original && typeof row.original === "object" && !Array.isArray(row.original) ? (row.original as Record<string, unknown>) : {};
  const c = row.corrected && typeof row.corrected === "object" && !Array.isArray(row.corrected) ? (row.corrected as Record<string, unknown>) : {};
  const fields = (row.changed_fields ?? []).map((f) => ({ field: correctionFieldLabel(f), before: scalar(o[f]), after: scalar(c[f]) }));
  return { id: row.id ?? null, at: row.corrected_at, reason: row.reason, fields };
}

export function correctionText(c: CorrectionSnapshot): string {
  return c.fields.map((f) => `${f.field}: ${f.before} → ${f.after}`).join(", ");
}
