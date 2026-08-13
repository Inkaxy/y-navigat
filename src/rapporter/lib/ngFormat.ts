/**
 * Filformat for NorgesGruppen «DirekteLevert».
 * EKSAKT spesifikasjon — avvik er feil:
 * - 16 semikolon-separerte kolonner
 * - UTF-8 UTEN BOM, LF-linjeskift, INGEN avsluttende linjeskift
 * - Beløp/antall med punktum som desimaltegn og alltid 2 desimaler
 */

export const NG_COLUMNS = [
  "UKE_NR",
  "MANED_NR",
  "LEVERANDOR_GLN_NR",
  "LEVERANDOR_NAVN",
  "KUNDE_GLN_NR",
  "KUNDE_NAVN",
  "PROFILKJEDE_NR",
  "PROFILKJEDE_NAVN",
  "VARE_GTIN_NR",
  "VARE_NAVN",
  "ENVAGRUPPE_NR",
  "ENVAGRUPPE_NAVN",
  "UNDERGRUPPE_NR",
  "UNDERGRUPPE_NAVN",
  "KJOP_BELOP",
  "KJOP_ANTALL_VEKT",
] as const;

export const NG_HEADER = NG_COLUMNS.join(";");

export type NgReportRow = {
  kunde_gln: string | null;
  kunde_navn: string | null;
  vare_gtin: string | null;
  vare_navn: string | null;
  kjop_belop: number | string | null;
  kjop_antall: number | string | null;
};

export type NgFileMeta = {
  supplierGln: string;
  supplierName: string;
  /** YYYYMM */
  monthNr: string;
};

function num(v: number | string | null | undefined): string {
  return Number(v ?? 0).toFixed(2);
}

/** Bygger de 16 cellene for én rad (tomme kolonner som tom streng). */
export function ngRowCells(row: NgReportRow, meta: NgFileMeta): string[] {
  return [
    "", // UKE_NR
    meta.monthNr, // MANED_NR
    meta.supplierGln,
    meta.supplierName,
    row.kunde_gln ?? "",
    row.kunde_navn ?? "",
    "", // PROFILKJEDE_NR
    "", // PROFILKJEDE_NAVN
    row.vare_gtin ?? "",
    row.vare_navn ?? "",
    "", // ENVAGRUPPE_NR
    "", // ENVAGRUPPE_NAVN
    "", // UNDERGRUPPE_NR
    "", // UNDERGRUPPE_NAVN
    num(row.kjop_belop),
    num(row.kjop_antall),
  ];
}

/** Hele filinnholdet. Ingen BOM, LF, ingen avsluttende linjeskift. */
export function buildNgFile(rows: NgReportRow[], meta: NgFileMeta): string {
  const lines = [NG_HEADER, ...rows.map((r) => ngRowCells(r, meta).join(";"))];
  return lines.join("\n");
}

function ymd(date: string): string {
  return date.replace(/-/g, "");
}

export function ngFileName(periodStart: string, periodEnd: string): string {
  return `NGDirekteLevert_nottero_${ymd(periodStart)}_${ymd(periodEnd)}_${Date.now()}.csv`;
}

/** Laster ned innholdet som fil — Blob uten BOM. */
export function downloadNgFile(content: string, fileName: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Månedsnummer (YYYYMM) fra en ISO-dato. */
export function monthNrFrom(date: string): string {
  return date.slice(0, 4) + date.slice(5, 7);
}
