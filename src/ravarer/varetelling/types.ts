/** Typer og strenge parsere for det nye varetellingssystemet (vt_*). */

export type CountStatus = "planlagt" | "pagar" | "til_kontroll" | "avsluttet" | "avbrutt";
export type ListStatus = "ikke_startet" | "under_telling" | "til_kontroll" | "godkjent";
export type LineState = "ikke_talt" | "talt" | "null" | "ikke_her" | "ma_kontrolleres";
export type PriceSource = "verifisert_kostpris" | "mangler_verifisert_pris" | "historisk_ikke_tilgjengelig";

export interface VtLocation { id: string; department: string; name: string; sort_order: number; archived_at: string | null }
export interface VtTemplate {
  id: string; name: string; department: string; default_location_id: string | null;
  revision: number; archived_at: string | null; updated_at: string;
}
export interface VtTemplateLine {
  id: string; template_id: string; raw_material_id: string; location_id: string | null; sort_order: number;
}
export interface VtCount {
  id: string; name: string; planned_date: string; valuation_date: string; status: CountStatus;
  template_ids: string[]; revision: number; started_at: string | null; finished_at: string | null;
  cancel_reason: string | null; created_at: string;
}
export interface VtCountList {
  id: string; count_id: string; source_template_id: string; source_template_revision: number;
  name: string; department: string; status: ListStatus; sort_order: number;
}
export interface SnapUnit { id: string; label: string; units_in_base: number }
export interface EntryPart { unit_id: string | null; label: string; units_in_base: number; amount: number }
export interface VtCountLine {
  id: string; count_id: string; count_list_id: string; raw_material_id: string; location_id: string | null;
  sort_order: number; snap_name: string; snap_sku: string | null; snap_location_name: string | null;
  snap_base_unit: string; snap_units: SnapUnit[]; snap_price_per_base: number | null;
  snap_price_source: PriceSource; snap_currency: string; snap_taken_at: string;
  state: LineState; counted_base: number | null; entry: EntryPart[]; note: string | null;
  revision: number; updated_at: string;
}
/** Råvare i firmaet som kan legges på en liste. */
export interface VtMaterial {
  id: string; name: string; sku: string | null; base_unit: string | null;
  stock_tracking: boolean; is_active: boolean; cost_basis_status: string | null;
}
export interface Coverage {
  duplicates: { raw_material_id: string; location_id: string | null; template_ids: string[] }[];
  missing_price: number; missing_location: number; line_count: number;
}

export type SaveLineResult =
  | { kind: "saved"; line: VtCountLine; alreadyApplied: boolean }
  | { kind: "conflict"; current: VtCountLine };

export class VtParseError extends Error {
  constructor(what: string) { super(`Uventet svar fra serveren (${what})`); }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (r: Rec, k: string): string => { const v = r[k]; if (typeof v !== "string") throw new VtParseError(k); return v; };
const strN = (r: Rec, k: string): string | null => { const v = r[k]; if (v == null) return null; if (typeof v !== "string") throw new VtParseError(k); return v; };
const num = (r: Rec, k: string): number => {
  const v = typeof r[k] === "string" ? Number(r[k]) : r[k];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new VtParseError(k); return v;
};
const numN = (r: Rec, k: string): number | null => (r[k] == null ? null : num(r, k));
const bool = (r: Rec, k: string): boolean => { const v = r[k]; if (typeof v !== "boolean") throw new VtParseError(k); return v; };
const oneOf = <T extends string>(r: Rec, k: string, all: readonly T[]): T => {
  const v = str(r, k); if (!(all as readonly string[]).includes(v)) throw new VtParseError(k); return v as T;
};
const rec = (v: unknown, what: string): Rec => { if (!isRec(v)) throw new VtParseError(what); return v; };

export const COUNT_STATUSES = ["planlagt", "pagar", "til_kontroll", "avsluttet", "avbrutt"] as const;
export const LIST_STATUSES = ["ikke_startet", "under_telling", "til_kontroll", "godkjent"] as const;
export const LINE_STATES = ["ikke_talt", "talt", "null", "ikke_her", "ma_kontrolleres"] as const;
const PRICE_SOURCES = ["verifisert_kostpris", "mangler_verifisert_pris", "historisk_ikke_tilgjengelig"] as const;

export function parseLocation(v: unknown): VtLocation {
  const r = rec(v, "sted");
  return { id: str(r, "id"), department: str(r, "department"), name: str(r, "name"), sort_order: num(r, "sort_order"), archived_at: strN(r, "archived_at") };
}
export function parseTemplate(v: unknown): VtTemplate {
  const r = rec(v, "mal");
  return { id: str(r, "id"), name: str(r, "name"), department: str(r, "department"), default_location_id: strN(r, "default_location_id"),
    revision: num(r, "revision"), archived_at: strN(r, "archived_at"), updated_at: str(r, "updated_at") };
}
export function parseTemplateLine(v: unknown): VtTemplateLine {
  const r = rec(v, "mallinje");
  return { id: str(r, "id"), template_id: str(r, "template_id"), raw_material_id: str(r, "raw_material_id"), location_id: strN(r, "location_id"), sort_order: num(r, "sort_order") };
}
function uuidArr(r: Rec, k: string): string[] {
  const v = r[k]; if (!Array.isArray(v) || v.some(x => typeof x !== "string")) throw new VtParseError(k);
  return v.filter((x): x is string => typeof x === "string");
}
export function parseCount(v: unknown): VtCount {
  const r = rec(v, "telling");
  return { id: str(r, "id"), name: str(r, "name"), planned_date: str(r, "planned_date"), valuation_date: str(r, "valuation_date"),
    status: oneOf(r, "status", COUNT_STATUSES), template_ids: uuidArr(r, "template_ids"), revision: num(r, "revision"),
    started_at: strN(r, "started_at"), finished_at: strN(r, "finished_at"), cancel_reason: strN(r, "cancel_reason"), created_at: str(r, "created_at") };
}
export function parseCountList(v: unknown): VtCountList {
  const r = rec(v, "telleliste");
  return { id: str(r, "id"), count_id: str(r, "count_id"), source_template_id: str(r, "source_template_id"),
    source_template_revision: num(r, "source_template_revision"), name: str(r, "name"), department: str(r, "department"),
    status: oneOf(r, "status", LIST_STATUSES), sort_order: num(r, "sort_order") };
}
function parseUnits(v: unknown): SnapUnit[] {
  if (!Array.isArray(v)) throw new VtParseError("snap_units");
  return v.map(u => { const r = rec(u, "enhet"); return { id: str(r, "id"), label: str(r, "label"), units_in_base: num(r, "units_in_base") }; });
}
function parseEntry(v: unknown): EntryPart[] {
  if (!Array.isArray(v)) throw new VtParseError("entry");
  return v.map(u => { const r = rec(u, "registrering"); return { unit_id: strN(r, "unit_id"), label: str(r, "label"), units_in_base: num(r, "units_in_base"), amount: num(r, "amount") }; });
}
export function parseCountLine(v: unknown): VtCountLine {
  const r = rec(v, "tellelinje");
  return { id: str(r, "id"), count_id: str(r, "count_id"), count_list_id: str(r, "count_list_id"), raw_material_id: str(r, "raw_material_id"),
    location_id: strN(r, "location_id"), sort_order: num(r, "sort_order"), snap_name: str(r, "snap_name"), snap_sku: strN(r, "snap_sku"),
    snap_location_name: strN(r, "snap_location_name"), snap_base_unit: str(r, "snap_base_unit"), snap_units: parseUnits(r.snap_units),
    snap_price_per_base: numN(r, "snap_price_per_base"), snap_price_source: oneOf(r, "snap_price_source", PRICE_SOURCES),
    snap_currency: str(r, "snap_currency"), snap_taken_at: str(r, "snap_taken_at"), state: oneOf(r, "state", LINE_STATES),
    counted_base: numN(r, "counted_base"), entry: parseEntry(r.entry), note: strN(r, "note"), revision: num(r, "revision"), updated_at: str(r, "updated_at") };
}
export function parseMaterial(v: unknown): VtMaterial {
  const r = rec(v, "vare");
  return { id: str(r, "id"), name: str(r, "name"), sku: strN(r, "sku"), base_unit: strN(r, "base_unit"),
    stock_tracking: r.stock_tracking === true, is_active: r.is_active !== false, cost_basis_status: strN(r, "cost_basis_status") };
}
export function parseCoverage(v: unknown): Coverage {
  const r = rec(v, "dekning");
  if (!Array.isArray(r.duplicates)) throw new VtParseError("duplicates");
  return {
    duplicates: r.duplicates.map(d => { const x = rec(d, "duplikat"); return { raw_material_id: str(x, "raw_material_id"), location_id: strN(x, "location_id"), template_ids: uuidArr(x, "template_ids") }; }),
    missing_price: num(r, "missing_price"), missing_location: num(r, "missing_location"), line_count: num(r, "line_count"),
  };
}
export function parseSaveLine(v: unknown, lineId: string): SaveLineResult {
  const r = rec(v, "lagring");
  const line = parseCountLine(r.line);
  if (line.id !== lineId) throw new VtParseError("linjeidentitet");
  if (r.ok === false && r.conflict === true) return { kind: "conflict", current: line };
  if (r.ok !== true || r.conflict !== false && r.conflict !== undefined) throw new VtParseError("ok");
  return { kind: "saved", line, alreadyApplied: r.already_applied === true };
}
export function parseOkId(v: unknown, key: string, expected?: string): { id: string; repeated: boolean; raw: Rec } {
  const r = rec(v, "svar");
  if (!bool(r, "ok")) throw new VtParseError("ok");
  const id = str(r, key);
  if (expected && id !== expected) throw new VtParseError("identitet");
  return { id, repeated: r.already_created === true || r.already_started === true || r.already_applied === true, raw: r };
}
