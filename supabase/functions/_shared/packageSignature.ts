// DENNE FILEN ER BYTE-IDENTISK MED src/fakturaer/lib/packageSignature.ts.
// Endres den ene, må den andre endres likt — en vitest sammenligner filene.
//
// Hvilken leverandørkobling er pakningskilden for en fakturalinje?
// Felles regel for skjermen og matchemotoren. Ingen toleranser: en pakning er
// entydig bare når HELE signaturen (størrelse, enhet, innhold i grunnenhet og
// bekreftelse) er lik, eller når varenummeret peker på nøyaktig én rad.

export interface PackageRow {
  id?: string;
  supplier_sku?: string | null;
  package_size?: number | string | null;
  package_unit?: string | null;
  base_units_per_package?: number | string | null;
  package_confirmed_at?: string | null;
}

const num = (v: unknown): string => {
  if (v == null || v === "") return "-";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "-";
};

/** Full pakningssignatur. To rader med NULL innhold men 1 kg og 25 kg er ULIKE. */
export function packageSignature(r: PackageRow): string {
  return [
    num(r.package_size),
    (r.package_unit ?? "").trim().toLowerCase() || "-",
    num(r.base_units_per_package),
    r.package_confirmed_at ? "bekreftet" : "ubekreftet",
  ].join("|");
}

const skuKey = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, "");

/**
 * Velger raden blant ÉN råvares koblinger hos leverandøren.
 * 1) `exactRowId` — kun når treffet allerede er radpresist (bekreftet SKU-alias).
 * 2) Nøyaktig én rad med samme varenummer som linjen.
 * 3) Alle rader har identisk signatur.
 * Ellers konflikt — aldri «første rad».
 */
export function pickPackageRow<T extends PackageRow>(
  rows: readonly T[],
  sku: string | null | undefined,
  exactRowId?: string | null,
): { row: T | undefined; conflict: boolean } {
  if (rows.length === 0) return { row: undefined, conflict: false };
  if (exactRowId) {
    const hit = rows.find((r) => r.id === exactRowId);
    if (hit) return { row: hit, conflict: false };
  }
  if (rows.length === 1) return { row: rows[0], conflict: false };
  const k = skuKey(sku);
  if (k) {
    const bySku = rows.filter((r) => skuKey(r.supplier_sku) === k);
    if (bySku.length === 1) return { row: bySku[0], conflict: false };
    if (bySku.length > 1) {
      const sigs = new Set(bySku.map(packageSignature));
      return sigs.size === 1 ? { row: bySku[0], conflict: false } : { row: undefined, conflict: true };
    }
  }
  const sigs = new Set(rows.map(packageSignature));
  return sigs.size === 1 ? { row: rows[0], conflict: false } : { row: undefined, conflict: true };
}
