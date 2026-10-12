/** Typer og strenge parsere for det nye varetellingssystemet (vt_*, SQL-revisjon 2). */

export type CountStatus = "planlagt" | "pagar" | "til_kontroll" | "avsluttet" | "avbrutt";
export type ListStatus = "ikke_startet" | "under_telling" | "til_kontroll" | "godkjent";
export type LineState = "ikke_talt" | "talt" | "null" | "ikke_her" | "ma_kontrolleres";
export type PriceSource = "dokumentert_kostpris" | "historisk_dokumentert" | "mangler_pris";
export type ValuationMode = "ved_start" | "historisk";
export type BaseUnit = "kg" | "g" | "l" | "ml" | "stk";

export interface VtLocation { id: string; department: string; name: string; sort_order: number; revision: number; archived_at: string | null }
export interface VtTemplate {
  id: string; name: string; department: string; default_location_id: string | null;
  revision: number; archived_at: string | null; updated_at: string;
}
export interface VtTemplateLine {
  id: string; template_id: string; raw_material_id: string; location_id: string | null; sort_order: number; count_unit_ids: string[];
}
export interface TemplateLineInput { raw_material_id: string; location_id: string | null; count_unit_ids: string[] }
export interface VtCount {
  id: string; name: string; planned_date: string; valuation_mode: ValuationMode; valuation_date: string | null; status: CountStatus;
  template_ids: string[]; revision: number; started_at: string | null; finished_at: string | null;
  cancel_reason: string | null; created_at: string;
}
export interface VtCountList {
  id: string; count_id: string; source_template_id: string; source_template_revision: number;
  name: string; department: string; status: ListStatus; revision: number; sort_order: number;
}
export interface SnapUnit { id: string; label: string; units_in_base: number }
/** Serverbygd registreringsdel (etikett/faktor fra frosset grunnlag). */
export interface EntryPart { unit_id: string | null; label: string; units_in_base: number; amount: number }
/** Det klienten sender: bare enhets-ID og antall. Serveren slår opp faktor selv. */
export interface EntryInput { unit_id: string | null; amount: number }
export interface VtCountLine {
  id: string; count_id: string; count_list_id: string; raw_material_id: string; location_id: string | null;
  sort_order: number; snap_name: string; snap_sku: string | null; snap_location_name: string | null;
  snap_base_unit: BaseUnit | null; snap_units: SnapUnit[]; snap_price_per_base: number | null;
  snap_price_source: PriceSource; snap_price_reason: string | null; snap_price_history_id: string | null;
  snap_price_effective_date: string | null; snap_price_as_of: string; snap_price_known_after_valuation: boolean;
  snap_currency: string; snap_taken_at: string;
  state: LineState; counted_base: number | null; entry: EntryPart[]; note: string | null;
  revision: number; updated_at: string;
}
/** Råvare i firmaet. Alle aktive varer kan telles, uavhengig av lagerføring. */
export interface VtMaterial {
  id: string; name: string; sku: string | null; base_unit: string | null;
  stock_tracking: boolean; is_active: boolean; category: string | null; categories: string[];
}
export interface Coverage {
  as_of: string; valuation_mode: ValuationMode; invoice_access: boolean;
  duplicates: { raw_material_id: string; location_id: string | null; template_ids: string[] }[];
  line_count: number; material_count: number; missing_location: number; archived_location: number; empty_templates: number;
  priced: number; missing_price: number; missing_price_by_reason: Record<string, number>; missing_unit: number; known_after_valuation: number;
}

export type SaveLineResult =
  | { kind: "saved"; line: VtCountLine; replayed: boolean }
  | { kind: "conflict"; current: VtCountLine; replayed: boolean };

export class VtParseError extends Error {
  constructor(what: string) { super(`Uventet svar fra serveren (${what})`); }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (r: Rec, k: string): string => { const v = r[k]; if (typeof v !== "string") throw new VtParseError(k); return v; };
const strN = (r: Rec, k: string): string | null => { const v = r[k]; if (v == null) return null; if (typeof v !== "string") throw new VtParseError(k); return v; };
const num = (r: Rec, k: string): number => {
  const raw = r[k];
  const v = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new VtParseError(k); return v;
};
const int = (r: Rec, k: string): number => { const v = num(r, k); if (!Number.isInteger(v)) throw new VtParseError(k); return v; };
const numN = (r: Rec, k: string): number | null => (r[k] == null ? null : num(r, k));
const bool = (r: Rec, k: string): boolean => { const v = r[k]; if (typeof v !== "boolean") throw new VtParseError(k); return v; };
const oneOf = <T extends string>(r: Rec, k: string, all: readonly T[]): T => {
  const v = str(r, k); const hit = all.find(a => a === v); if (hit === undefined) throw new VtParseError(k); return hit;
};
const oneOfN = <T extends string>(r: Rec, k: string, all: readonly T[]): T | null => (r[k] == null ? null : oneOf(r, k, all));
export const rec = (v: unknown, what: string): Rec => { if (!isRec(v)) throw new VtParseError(what); return v; };
function strArr(r: Rec, k: string): string[] {
  const v = r[k]; if (!Array.isArray(v)) throw new VtParseError(k);
  return v.map(x => { if (typeof x !== "string") throw new VtParseError(k); return x; });
}

export const COUNT_STATUSES = ["planlagt", "pagar", "til_kontroll", "avsluttet", "avbrutt"] as const;
export const LIST_STATUSES = ["ikke_startet", "under_telling", "til_kontroll", "godkjent"] as const;
export const LINE_STATES = ["ikke_talt", "talt", "null", "ikke_her", "ma_kontrolleres"] as const;
export const PRICE_SOURCES = ["dokumentert_kostpris", "historisk_dokumentert", "mangler_pris"] as const;
export const VALUATION_MODES = ["ved_start", "historisk"] as const;
export const BASE_UNITS = ["kg", "g", "l", "ml", "stk"] as const;

export function parseLocation(v: unknown): VtLocation {
  const r = rec(v, "sted");
  return { id: str(r, "id"), department: str(r, "department"), name: str(r, "name"), sort_order: int(r, "sort_order"), revision: int(r, "revision"), archived_at: strN(r, "archived_at") };
}
export function parseTemplate(v: unknown): VtTemplate {
  const r = rec(v, "mal");
  return { id: str(r, "id"), name: str(r, "name"), department: str(r, "department"), default_location_id: strN(r, "default_location_id"),
    revision: int(r, "revision"), archived_at: strN(r, "archived_at"), updated_at: str(r, "updated_at") };
}
export function parseTemplateLine(v: unknown): VtTemplateLine {
  const r = rec(v, "mallinje");
  return { id: str(r, "id"), template_id: str(r, "template_id"), raw_material_id: str(r, "raw_material_id"), location_id: strN(r, "location_id"),
    sort_order: int(r, "sort_order"), count_unit_ids: strArr(r, "count_unit_ids") };
}
export function parseCount(v: unknown): VtCount {
  const r = rec(v, "telling");
  return { id: str(r, "id"), name: str(r, "name"), planned_date: str(r, "planned_date"), valuation_mode: oneOf(r, "valuation_mode", VALUATION_MODES),
    valuation_date: strN(r, "valuation_date"), status: oneOf(r, "status", COUNT_STATUSES), template_ids: strArr(r, "template_ids"), revision: int(r, "revision"),
    started_at: strN(r, "started_at"), finished_at: strN(r, "finished_at"), cancel_reason: strN(r, "cancel_reason"), created_at: str(r, "created_at") };
}
export function parseCountList(v: unknown): VtCountList {
  const r = rec(v, "telleliste");
  return { id: str(r, "id"), count_id: str(r, "count_id"), source_template_id: str(r, "source_template_id"),
    source_template_revision: int(r, "source_template_revision"), name: str(r, "name"), department: str(r, "department"),
    status: oneOf(r, "status", LIST_STATUSES), revision: int(r, "revision"), sort_order: int(r, "sort_order") };
}
function parseUnits(v: unknown): SnapUnit[] {
  if (!Array.isArray(v)) throw new VtParseError("snap_units");
  return v.map(u => { const r = rec(u, "enhet"); const f = num(r, "units_in_base"); if (f <= 0) throw new VtParseError("faktor"); return { id: str(r, "id"), label: str(r, "label"), units_in_base: f }; });
}
function parseEntry(v: unknown): EntryPart[] {
  if (!Array.isArray(v)) throw new VtParseError("entry");
  return v.map(u => { const r = rec(u, "registrering"); return { unit_id: strN(r, "unit_id"), label: str(r, "label"), units_in_base: num(r, "units_in_base"), amount: num(r, "amount") }; });
}
export function parseCountLine(v: unknown): VtCountLine {
  const r = rec(v, "tellelinje");
  const price = numN(r, "snap_price_per_base");
  const source = oneOf(r, "snap_price_source", PRICE_SOURCES);
  if ((source === "mangler_pris") !== (price == null) || (price != null && price <= 0)) throw new VtParseError("prisgrunnlag");
  return { id: str(r, "id"), count_id: str(r, "count_id"), count_list_id: str(r, "count_list_id"), raw_material_id: str(r, "raw_material_id"),
    location_id: strN(r, "location_id"), sort_order: int(r, "sort_order"), snap_name: str(r, "snap_name"), snap_sku: strN(r, "snap_sku"),
    snap_location_name: strN(r, "snap_location_name"), snap_base_unit: oneOfN(r, "snap_base_unit", BASE_UNITS), snap_units: parseUnits(r.snap_units),
    snap_price_per_base: price, snap_price_source: source, snap_price_reason: strN(r, "snap_price_reason"),
    snap_price_history_id: strN(r, "snap_price_history_id"), snap_price_effective_date: strN(r, "snap_price_effective_date"),
    snap_price_as_of: str(r, "snap_price_as_of"), snap_price_known_after_valuation: bool(r, "snap_price_known_after_valuation"),
    snap_currency: str(r, "snap_currency"), snap_taken_at: str(r, "snap_taken_at"), state: oneOf(r, "state", LINE_STATES),
    counted_base: numN(r, "counted_base"), entry: parseEntry(r.entry), note: strN(r, "note"), revision: int(r, "revision"), updated_at: str(r, "updated_at") };
}
export function parseMaterial(v: unknown): VtMaterial {
  const r = rec(v, "vare");
  const cats = r.categories == null ? [] : strArr(r, "categories");
  return { id: str(r, "id"), name: str(r, "name"), sku: strN(r, "sku"), base_unit: strN(r, "base_unit"),
    stock_tracking: r.stock_tracking === true, is_active: r.is_active !== false, category: strN(r, "category"), categories: cats };
}
export function parseCoverage(v: unknown): Coverage {
  const r = rec(v, "dekning");
  if (!Array.isArray(r.duplicates)) throw new VtParseError("duplicates");
  const by = rec(r.missing_price_by_reason, "årsaker");
  const reasons: Record<string, number> = {};
  for (const k of Object.keys(by)) reasons[k] = int(by, k);
  return {
    as_of: str(r, "as_of"), valuation_mode: oneOf(r, "valuation_mode", VALUATION_MODES), invoice_access: bool(r, "invoice_access"),
    duplicates: r.duplicates.map(d => { const x = rec(d, "duplikat"); return { raw_material_id: str(x, "raw_material_id"), location_id: strN(x, "location_id"), template_ids: strArr(x, "template_ids") }; }),
    line_count: int(r, "line_count"), material_count: int(r, "material_count"), missing_location: int(r, "missing_location"),
    archived_location: int(r, "archived_location"), empty_templates: int(r, "empty_templates"), priced: int(r, "priced"),
    missing_price: int(r, "missing_price"), missing_price_by_reason: reasons, missing_unit: int(r, "missing_unit"), known_after_valuation: int(r, "known_after_valuation"),
  };
}

// ---------- Kvitteringer (strengt bundet til forventet mål) ----------
function receipt(v: unknown, kind: string): Rec {
  const r = rec(v, "kvittering");
  if (r.ok !== true && !(kind === "save_line" && r.ok === false)) throw new VtParseError("ok");
  if (r.kind !== kind) throw new VtParseError("type");
  if (typeof r.replayed !== "boolean") throw new VtParseError("replayed");
  return r;
}
export function parseSaveLine(v: unknown, lineId: string, expectedRevision: number): SaveLineResult {
  const r = receipt(v, "save_line");
  const line = parseCountLine(r.line);
  if (line.id !== lineId) throw new VtParseError("linjeidentitet");
  const replayed = r.replayed === true;
  if (r.ok === false) {
    if (r.conflict !== true || line.revision === expectedRevision) throw new VtParseError("konflikt");
    return { kind: "conflict", current: line, replayed };
  }
  if (r.conflict !== false || line.revision !== expectedRevision + 1) throw new VtParseError("revisjon");
  return { kind: "saved", line, replayed };
}
export function parseLocationReceipt(v: unknown, expect: { id: string | null; expectedRevision: number | null }): { location: VtLocation; replayed: boolean } {
  const r = receipt(v, "location");
  const location = parseLocation(r.location);
  if (expect.id && location.id !== expect.id) throw new VtParseError("stedidentitet");
  if (location.revision !== (expect.expectedRevision == null ? 1 : expect.expectedRevision + 1)) throw new VtParseError("revisjon");
  return { location, replayed: r.replayed === true };
}
export function parseTemplateReceipt(v: unknown, expect: { id: string | null; expectedRevision: number | null; lineCount: number | null }): { template: VtTemplate; lineCount: number; replayed: boolean } {
  const r = receipt(v, "template");
  const template = parseTemplate(r.template);
  const lineCount = int(r, "line_count");
  if (expect.id && template.id !== expect.id) throw new VtParseError("malidentitet");
  if (template.revision !== (expect.expectedRevision == null ? 1 : expect.expectedRevision + 1)) throw new VtParseError("revisjon");
  if (expect.lineCount != null && lineCount !== expect.lineCount) throw new VtParseError("antall linjer");
  return { template, lineCount, replayed: r.replayed === true };
}
export function parseCreateReceipt(v: unknown, templateIds: string[]): { countId: string; revision: number; replayed: boolean } {
  const r = receipt(v, "create_count");
  const ids = strArr(r, "template_ids");
  const want = [...templateIds].sort();
  if (r.status !== "planlagt" || int(r, "revision") !== 1 || ids.length !== want.length || [...ids].sort().some((x, i) => x !== want[i])) throw new VtParseError("telling");
  return { countId: str(r, "count_id"), revision: 1, replayed: r.replayed === true };
}
export interface StartReceipt { revision: number; listCount: number; lineCount: number; pricedCount: number; valuationMode: ValuationMode; valuationDate: string; replayed: boolean }
export function parseStartReceipt(v: unknown, countId: string, expectedRevision: number): StartReceipt {
  const r = receipt(v, "start_count");
  if (r.count_id !== countId || r.status !== "pagar" || int(r, "revision") !== expectedRevision + 1) throw new VtParseError("start");
  const lineCount = int(r, "line_count"); const pricedCount = int(r, "priced_count"); const listCount = int(r, "list_count");
  if (lineCount < 1 || listCount < 1 || pricedCount < 0 || pricedCount > lineCount) throw new VtParseError("antall");
  return { revision: expectedRevision + 1, listCount, lineCount, pricedCount, valuationMode: oneOf(r, "valuation_mode", VALUATION_MODES),
    valuationDate: str(r, "valuation_date"), replayed: r.replayed === true };
}
export function parseListStatusReceipt(v: unknown, listId: string, expectedRevision: number, status: ListStatus): { revision: number; replayed: boolean } {
  const r = receipt(v, "list_status");
  if (r.list_id !== listId || r.status !== status || int(r, "revision") !== expectedRevision + 1) throw new VtParseError("liste");
  return { revision: expectedRevision + 1, replayed: r.replayed === true };
}
export function parseTransitionReceipt(v: unknown, countId: string, expectedRevision: number, to: CountStatus): { revision: number; replayed: boolean } {
  const r = receipt(v, "transition");
  if (r.count_id !== countId || r.status !== to || int(r, "revision") !== expectedRevision + 1) throw new VtParseError("overgang");
  return { revision: expectedRevision + 1, replayed: r.replayed === true };
}
export function parseBackendVersion(v: unknown): number {
  const r = rec(v, "versjon");
  if (r.system !== "varetelling") throw new VtParseError("system");
  return int(r, "version");
}
