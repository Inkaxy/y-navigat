/**
 * Enkel .xlsx-eksport for Rapporter (SheetJS).
 * Tall skrives som ekte tall (ikke tekst) med norsk tallformat i cellene,
 * slik at Excel kan summere direkte.
 */
import * as XLSX from "xlsx";

export type XlsxColumn = {
  header: string;
  /** Kolonnebredde i tegn. */
  width?: number;
  /** Tallformat for kolonnen, f.eks. "#,##0.00". */
  format?: string;
};

export type XlsxCell = string | number | null | undefined;

export function downloadXlsx(
  filename: string,
  sheetName: string,
  columns: XlsxColumn[],
  rows: XlsxCell[][],
) {
  const aoa: XlsxCell[][] = [columns.map((c) => c.header), ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][]);

  ws["!cols"] = columns.map((c) => ({ wch: c.width ?? Math.max(10, c.header.length + 2) }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  // Sett tallformat på numeriske celler per kolonne.
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < columns.length; c += 1) {
      const fmt = columns[c].format;
      if (!fmt) continue;
      const addr = XLSX.utils.encode_cell({ r: r + 1, c });
      const cell = ws[addr];
      if (cell && cell.t === "n") cell.z = fmt;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

/** Standard tallformater. */
export const FMT_NOK = "#,##0.00";
export const FMT_QTY = "#,##0.##";
export const FMT_PCT = "#,##0.0";
