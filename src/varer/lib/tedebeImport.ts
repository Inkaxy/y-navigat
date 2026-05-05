/**
 * Parser og typer for Tedebe F82-eksport.
 * Filformat: 5 kolonner (varenummer, varenavn, utsalgspris eks mva, engrospris eks mva, momskode).
 * Støtter CSV (UTF-8 m/BOM, . eller , som desimaltegn) og Excel (xlsx).
 */
import Papa from "papaparse";
import * as XLSX from "xlsx";

/* ---- Typer ---- */

export type Momskode = "F" | "H" | "P" | null;

export interface RawRow {
  row_index: number; // 1-basert (header er rad 0)
  varenummer: number | null;
  varenavn: string;
  utsalgspris: number | null; // null hvis tom; aldri 0 eller negativ
  engrospris: number | null; // null hvis tom eller 0 (0 = ikke tilgjengelig for engros)
  momskode: Momskode;
  warnings: string[]; // valideringsadvarsler per rad
}

export interface ParseResult {
  rows: RawRow[];
  total_in_file: number;
  missing_columns: string[]; // tom = OK
  found_columns: string[];
  parse_errors: string[]; // generelle feil (encoding etc)
}

export const REQUIRED_COLUMNS = [
  "varenummer",
  "varenavn",
  "utsalgspris eks mva",
  "engrospris eks mva",
  "momskode",
] as const;

/* ---- Hjelpere ---- */

/** Map momskode → mva-rate (prosent). Default 15 (H = bakervarer). */
export function momskodeToMva(m: Momskode): number {
  switch (m) {
    case "F":
      return 0;
    case "P":
      return 25;
    case "H":
    case null:
    default:
      return 15;
  }
}

/** Slugify for product.code. ASCII, lowercase, _-separert. Bevar tall. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // fjern diakritikk
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function parseDecimal(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "" || s.toLowerCase() === "null") return null;
  // Norsk komma → punktum, fjern mellomrom
  const norm = s.replace(/\s/g, "").replace(",", ".");
  const n = Number.parseFloat(norm);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseInteger(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "") return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseMomskode(val: unknown): { code: Momskode; warning?: string } {
  if (val == null) return { code: null };
  const s = String(val).trim().toUpperCase();
  if (s === "" || s === "NULL") return { code: null };
  if (s === "F" || s === "H" || s === "P") return { code: s };
  return { code: "H", warning: `Ukjent momskode "${val}", default H (15%)` };
}

/* ---- Validering av rad-objekt ---- */

function buildRow(idx: number, raw: Record<string, unknown>): RawRow {
  const warnings: string[] = [];

  const varenummer = parseInteger(raw["varenummer"]);
  if (varenummer == null) warnings.push("Ugyldig varenummer");

  const varenavnRaw = raw["varenavn"];
  const varenavn = varenavnRaw == null ? "" : String(varenavnRaw).trim();
  if (!varenavn) warnings.push("Tomt varenavn");

  const utsalgspris = parseDecimal(raw["utsalgspris eks mva"]);
  const engrosRaw = parseDecimal(raw["engrospris eks mva"]);
  // 0 = ikke tilgjengelig for engros → null
  const engrospris = engrosRaw === 0 ? null : engrosRaw;

  const m = parseMomskode(raw["momskode"]);
  if (m.warning) warnings.push(m.warning);

  return {
    row_index: idx,
    varenummer,
    varenavn,
    utsalgspris: utsalgspris === 0 ? null : utsalgspris,
    engrospris,
    momskode: m.code,
    warnings,
  };
}

/* ---- Kolonnevalidering ---- */

function validateColumns(headers: string[]): {
  missing: string[];
  found: string[];
} {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const missing: string[] = [];
  for (const req of REQUIRED_COLUMNS) {
    if (!normalized.includes(req)) missing.push(req);
  }
  return { missing, found: normalized };
}

/* ---- Hovedparser: CSV ---- */

export async function parseCsvFile(file: File): Promise<ParseResult> {
  // Strip UTF-8 BOM hvis filen starter med det (papaparse gjør allerede dette,
  // men noen edge cases på header-navn kan slippe gjennom).
  const text = await file.text();
  const cleanText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  return new Promise<ParseResult>((resolve) => {
    Papa.parse<Record<string, unknown>>(cleanText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim().toLowerCase(),
      dynamicTyping: false,
      complete: (result) => {
        const headers = result.meta.fields ?? [];
        const colCheck = validateColumns(headers);
        if (colCheck.missing.length > 0) {
          resolve({
            rows: [],
            total_in_file: result.data.length,
            missing_columns: colCheck.missing,
            found_columns: colCheck.found,
            parse_errors: [],
          });
          return;
        }
        const rows: RawRow[] = result.data.map((r, i) => buildRow(i + 1, r));
        const parse_errors = (result.errors ?? []).slice(0, 5).map((e) => `Rad ${e.row}: ${e.message}`);
        resolve({
          rows,
          total_in_file: rows.length,
          missing_columns: [],
          found_columns: colCheck.found,
          parse_errors,
        });
      },
      error: (err: Error) => {
        resolve({
          rows: [],
          total_in_file: 0,
          missing_columns: [],
          found_columns: [],
          parse_errors: [err.message],
        });
      },
    });
  });
}

/* ---- Hovedparser: Excel ---- */

export async function parseXlsxFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "array" });
  } catch (e) {
    return {
      rows: [],
      total_in_file: 0,
      missing_columns: [],
      found_columns: [],
      parse_errors: [`Kunne ikke lese Excel-fil: ${(e as Error).message}`],
    };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      total_in_file: 0,
      missing_columns: [],
      found_columns: [],
      parse_errors: ["Filen inneholder ingen ark"],
    };
  }
  const sheet = wb.Sheets[sheetName];
  // header:1 → array of arrays. Første rad er headers.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  if (aoa.length === 0) {
    return {
      rows: [],
      total_in_file: 0,
      missing_columns: [],
      found_columns: [],
      parse_errors: ["Filen er tom"],
    };
  }
  const headers = (aoa[0] as unknown[]).map((h) => String(h ?? "").trim().toLowerCase());
  const colCheck = validateColumns(headers);
  if (colCheck.missing.length > 0) {
    return {
      rows: [],
      total_in_file: aoa.length - 1,
      missing_columns: colCheck.missing,
      found_columns: colCheck.found,
      parse_errors: [],
    };
  }

  const rows: RawRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx];
    });
    rows.push(buildRow(i, obj));
  }

  return {
    rows,
    total_in_file: rows.length,
    missing_columns: [],
    found_columns: colCheck.found,
    parse_errors: [],
  };
}

/* ---- Hovedinngang som velger parser basert på filtype ---- */

export async function parseTedebeFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseXlsxFile(file);
  }
  return parseCsvFile(file);
}

/* ---- Filter + statistikk for preview ---- */

export interface FilterOptions {
  skip_without_prices: boolean;
  varenr_min: number | null;
  varenr_max: number | null;
  momskoder: Set<"F" | "H" | "P" | "null">;
  create_new: boolean;
  update_existing: boolean;
  import_prices: boolean;
}

export interface ExistingProduct {
  id: string;
  display_number: number;
  display_name: string;
  mva_rate: number;
}

export type RowAction =
  | "create_with_prices"
  | "create_no_prices"
  | "update_match"
  | "update_name_conflict"
  | "skip_no_prices"
  | "skip_filter"
  | "skip_invalid";

export interface ClassifiedRow extends RawRow {
  action: RowAction;
  existing?: ExistingProduct;
  /** mva fra momskode etter mapping */
  mva_rate: number;
  /** Brukerens valg ved navnekonflikt: 'keep' | 'overwrite' | 'skip'. Settes av UI. */
  conflict_resolution?: "keep" | "overwrite" | "skip";
}

export function classifyRow(
  row: RawRow,
  existingByNumber: Map<number, ExistingProduct>,
  filter: FilterOptions,
): ClassifiedRow {
  const mva = momskodeToMva(row.momskode);

  // Ugyldig data → skip
  if (row.varenummer == null || !row.varenavn) {
    return { ...row, action: "skip_invalid", mva_rate: mva };
  }

  // Filter: momskode
  const mKey: "F" | "H" | "P" | "null" = row.momskode == null ? "null" : row.momskode;
  if (!filter.momskoder.has(mKey)) {
    return { ...row, action: "skip_filter", mva_rate: mva };
  }

  // Filter: varenummer-range
  if (filter.varenr_min != null && row.varenummer < filter.varenr_min) {
    return { ...row, action: "skip_filter", mva_rate: mva };
  }
  if (filter.varenr_max != null && row.varenummer > filter.varenr_max) {
    return { ...row, action: "skip_filter", mva_rate: mva };
  }

  const hasPrices = row.utsalgspris != null || row.engrospris != null;

  // Filter: hopp over uten priser
  if (filter.skip_without_prices && !hasPrices) {
    return { ...row, action: "skip_no_prices", mva_rate: mva };
  }

  const existing = existingByNumber.get(row.varenummer);

  if (existing) {
    if (!filter.update_existing && (!filter.import_prices || !hasPrices)) {
      return { ...row, action: "skip_filter", mva_rate: mva, existing };
    }
    // Navnesammenligning case-insensitiv + trim
    const sameName =
      existing.display_name.trim().toLowerCase() === row.varenavn.trim().toLowerCase();
    return {
      ...row,
      action: sameName ? "update_match" : "update_name_conflict",
      mva_rate: mva,
      existing,
    };
  }

  if (!filter.create_new) {
    return { ...row, action: "skip_filter", mva_rate: mva };
  }

  return {
    ...row,
    action: hasPrices ? "create_with_prices" : "create_no_prices",
    mva_rate: mva,
  };
}

export interface ClassificationStats {
  total: number;
  to_create: number;
  to_update: number;
  to_skip: number;
  conflicts: number;
  with_utsalg: number;
  with_engros: number;
  parse_errors: number;
}

export function buildStats(rows: ClassifiedRow[]): ClassificationStats {
  let to_create = 0;
  let to_update = 0;
  let to_skip = 0;
  let conflicts = 0;
  let with_utsalg = 0;
  let with_engros = 0;
  let parse_errors = 0;
  for (const r of rows) {
    if (r.warnings.length > 0 && r.action === "skip_invalid") parse_errors++;
    if (r.utsalgspris != null) with_utsalg++;
    if (r.engrospris != null) with_engros++;
    switch (r.action) {
      case "create_with_prices":
      case "create_no_prices":
        to_create++;
        break;
      case "update_match":
        to_update++;
        break;
      case "update_name_conflict":
        conflicts++;
        to_update++;
        break;
      case "skip_no_prices":
      case "skip_filter":
      case "skip_invalid":
        to_skip++;
        break;
    }
  }
  return {
    total: rows.length,
    to_create,
    to_update,
    to_skip,
    conflicts,
    with_utsalg,
    with_engros,
    parse_errors,
  };
}
