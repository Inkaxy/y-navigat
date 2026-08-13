/**
 * Felles tall- og eksportformatering for Rapporter.
 * CSV: semikolon-separert, komma som desimaltegn (Excel-NO), UTF-8 med BOM.
 */

const nokFmt = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 });

export function nok(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return nokFmt.format(v);
}

export function int(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return intFmt.format(v);
}

export function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return qtyFmt.format(v);
}

/** Prosentvis endring — null når grunnlaget er 0 (unngår NaN/Infinity). */
export function pctChange(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return (now - prev) / prev;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return `${(v * 100).toLocaleString("nb-NO", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

/** Andel av total — null når totalen er 0. */
export function share(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) return null;
  return part / total;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return v.toFixed(2).replace(".", ",");
  }
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(";"), ...rows.map((r) => r.map(csvCell).join(";"))].join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
