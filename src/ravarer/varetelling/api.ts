import { createContext, useContext } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllCounted } from "@/lib/countedPaging";
import {
  parseBackendVersion, parseCount, parseCountLine, parseCountList, parseCoverage, parseCreateReceipt, parseListStatusReceipt,
  parseLocation, parseLocationReceipt, parseMaterial, parseSaveLine, parseStartReceipt, parseTemplate, parseTemplateLine,
  parseTemplateReceipt, parseTransitionReceipt, rec,
  type Coverage, type EntryInput, type LineState, type SaveLineResult, type StartReceipt, type TemplateLineInput, type ValuationMode,
  type VtCount, type VtCountLine, type VtCountList, type VtLocation, type VtMaterial, type VtTemplate, type VtTemplateLine,
} from "./types";

/** Versjonen av SQL-forslaget denne klienten er skrevet mot. */
export const VT_BACKEND_VERSION = 2;

/** Ukjent utfall (nett/uventet svar): kan ha blitt lagret. Gjenta med SAMME operasjons-ID. */
export class VtUnknownOutcomeError extends Error {
  constructor() { super("Vi vet ikke om endringen ble lagret. Send den samme handlingen på nytt — den kan ikke bli registrert to ganger."); }
}
/** Serveren avviste med kjent grunn; ingenting ble skrevet. */
export class VtRejectedError extends Error {
  constructor(message: string, readonly code: string | null) { super(message); }
}
/** Tabellene/funksjonene er ikke rullet ut i databasen ennå. */
export class VtBackendUnavailableError extends Error {
  constructor() { super("Det nye tellesystemet er ikke tatt i bruk i databasen ennå."); }
}

export type ProbeResult = "ok" | "missing" | "outdated";
export type ListStatusTarget = "under_telling" | "til_kontroll" | "godkjent";
export type TransitionTarget = "til_kontroll" | "pagar" | "avsluttet" | "avbrutt";

export interface SaveLocationInput { opId: string; entity: string; id: string | null; expectedRevision: number | null; department: string; name: string; sortOrder: number; archived: boolean }
export interface SaveTemplateInput { opId: string; entity: string; id: string | null; expectedRevision: number | null; name: string; department: string; defaultLocationId: string | null; archived: boolean; lines: TemplateLineInput[] | null }
export interface CreateCountInput { opId: string; entity: string; name: string; plannedDate: string; valuationMode: ValuationMode; valuationDate: string | null; templateIds: string[] }
export interface SaveLineInput { opId: string; lineId: string; expectedRevision: number; state: LineState; countedBase: number | null; entry: EntryInput[]; note: string | null }

export interface VtApi {
  probe(entity: string): Promise<ProbeResult>;
  listLocations(entity: string): Promise<VtLocation[]>;
  listTemplates(entity: string): Promise<VtTemplate[]>;
  listTemplateLines(entity: string): Promise<VtTemplateLine[]>;
  listMaterials(entity: string): Promise<VtMaterial[]>;
  /** Navn på aktive produksjonsavdelinger (gjenbrukes som avdelingsforslag). */
  listDepartments(entity: string): Promise<string[]>;
  listCounts(entity: string): Promise<VtCount[]>;
  getCount(entity: string, id: string): Promise<{ count: VtCount; lists: VtCountList[]; lines: VtCountLine[] }>;
  checkCoverage(entity: string, templateIds: string[], mode: ValuationMode, valuationDate: string | null): Promise<Coverage>;
  saveLocation(i: SaveLocationInput): Promise<{ location: VtLocation; replayed: boolean }>;
  saveTemplate(i: SaveTemplateInput): Promise<{ template: VtTemplate; lineCount: number; replayed: boolean }>;
  copyTemplate(i: { opId: string; entity: string; sourceId: string; expectedRevision: number; name: string }): Promise<{ template: VtTemplate; lineCount: number; replayed: boolean }>;
  createCount(i: CreateCountInput): Promise<{ countId: string; revision: number; replayed: boolean }>;
  startCount(i: { opId: string; countId: string; expectedRevision: number }): Promise<StartReceipt>;
  saveLine(i: SaveLineInput): Promise<SaveLineResult>;
  setListStatus(i: { opId: string; listId: string; expectedRevision: number; status: ListStatusTarget }): Promise<{ revision: number; replayed: boolean }>;
  transitionCount(i: { opId: string; countId: string; expectedRevision: number; to: TransitionTarget; reason: string | null }): Promise<{ revision: number; replayed: boolean }>;
}

export const VtApiContext = createContext<VtApi | null>(null);
export function useVtApi(): VtApi {
  const api = useContext(VtApiContext);
  if (!api) throw new Error("VtApiContext mangler");
  return api;
}

// ---------------- Supabase-implementasjon ----------------
// vt_* finnes ikke i den genererte typefilen før migrasjonen er kjørt; derfor en utypet klient
// (samme instans/økt) og strenge parsere på alle svar.
const db: SupabaseClient = supabase;

const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205", "PGRST204"]);
type PgErr = { code?: string; message?: string } | null;

/** Bare SQLSTATE-er som beviser at ingenting ble skrevet, regnes som avvisning. Alt annet er ukjent utfall. */
export function rejectOrUnknown(e: PgErr): Error {
  const code = e?.code ?? null;
  if (code && MISSING.has(code)) return new VtBackendUnavailableError();
  if (code === "42501") return new VtRejectedError("Du mangler tilgang til denne handlingen.", code);
  if (code === "23505") return new VtRejectedError(serverText(e?.message) ?? "Finnes allerede (samme vare og sted, samme navn eller brukt operasjon).", code);
  if (code === "40001") return new VtRejectedError(serverText(e?.message) ?? "Endret av andre i mellomtiden. Last inn på nytt.", code);
  if (code === "55000") return new VtRejectedError(serverText(e?.message) ?? "Handlingen er ikke tillatt i denne statusen.", code);
  if (code === "22023" || code === "23514" || code === "22P02") return new VtRejectedError(serverText(e?.message) ?? "Ugyldige verdier.", code);
  return new VtUnknownOutcomeError();
}
/** Bare egne, norske servermeldinger vises; aldri rå tekniske feil. */
function serverText(m: string | undefined): string | null {
  return m && /[æøåÆØÅ]|telling|liste|linje|pris|mal|sted|vare|enhet|mengde|revisjon/i.test(m) && m.length < 160 && !/[{}]|violates|constraint/i.test(m) ? m : null;
}
async function call<T>(fn: () => PromiseLike<{ data: unknown; error: PgErr }>, parse: (d: unknown) => T): Promise<T> {
  let r: { data: unknown; error: PgErr };
  try { r = await fn(); } catch { throw new VtUnknownOutcomeError(); }
  if (r.error) throw rejectOrUnknown(r.error);
  try { return parse(r.data); } catch { throw new VtUnknownOutcomeError(); }
}
function readErr(e: PgErr): Error {
  return e?.code && MISSING.has(e.code) ? new VtBackendUnavailableError() : new Error("Kunne ikke hente data.");
}
async function read<T>(fn: () => PromiseLike<{ data: unknown; error: PgErr }>, parse: (d: unknown) => T): Promise<T> {
  const r = await fn();
  if (r.error) throw readErr(r.error);
  return parse(r.data);
}

/** Fullstendig henting via felles `fetchAllCounted` (eksakt antall, keyset, duplikat/overskudd, antall sjekkes på nytt). */
async function readAll<T extends { id: string }>(table: string, cols: string, filters: [string, string][], parse: (v: unknown) => T): Promise<T[]> {
  type Row = { id: string };
  const rows = await fetchAllCounted<Row>({
    count: () => { let q = db.from(table).select("id", { count: "exact", head: true }); for (const [k, v] of filters) q = q.eq(k, v); return q; },
    page: (after, size) => {
      let q = db.from(table).select(cols); for (const [k, v] of filters) q = q.eq(k, v);
      if (after) q = q.gt("id", after);
      return q.order("id").limit(size).then(r => ({ data: Array.isArray(r.data) ? r.data.map(x => { const o = rec(x, "rad"); if (typeof o.id !== "string") throw new Error("id"); return { ...o, id: o.id }; }) : null, error: r.error }));
    },
  }).catch((e: unknown) => { if (isPgErr(e)) throw readErr(e); throw e instanceof Error && e.message.includes("PGRST205") ? new VtBackendUnavailableError() : new Error("Kunne ikke hente alle rader."); });
  return rows.map(parse);
}
const isPgErr = (e: unknown): e is { code: string } => typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string";

const LOC = "id, department, name, sort_order, revision, archived_at";
const TPL = "id, name, department, default_location_id, revision, archived_at, updated_at";
const TPLL = "id, template_id, raw_material_id, location_id, sort_order, count_unit_ids";
const CNT = "id, name, planned_date, valuation_mode, valuation_date, status, template_ids, revision, started_at, finished_at, cancel_reason, created_at";
const LST = "id, count_id, source_template_id, source_template_revision, name, department, status, revision, sort_order";
const LIN = "id, count_id, count_list_id, raw_material_id, location_id, sort_order, snap_name, snap_sku, snap_location_name, snap_base_unit, snap_units, snap_price_per_base, snap_price_source, snap_price_reason, snap_price_history_id, snap_price_effective_date, snap_price_as_of, snap_price_known_after_valuation, snap_currency, snap_taken_at, state, counted_base, entry, note, revision, updated_at";
const MAT = "id, name, sku, base_unit, stock_tracking, is_active, category, categories";

export const supabaseVtApi: VtApi = {
  async probe() {
    // Sonde på faktisk backendversjon, ikke bare at en tabell finnes.
    const r = await db.rpc("vt_backend_version");
    if (r.error) {
      if (r.error.code && MISSING.has(r.error.code)) return "missing";
      throw new Error("Kunne ikke kontrollere tellesystemet.");
    }
    let v: number;
    try { v = parseBackendVersion(r.data); } catch { return "outdated"; }
    return v === VT_BACKEND_VERSION ? "ok" : "outdated";
  },
  listLocations: (e) => readAll("vt_locations", LOC, [["legal_entity_id", e]], parseLocation),
  listTemplates: (e) => readAll("vt_templates", TPL, [["legal_entity_id", e]], parseTemplate),
  listTemplateLines: (e) => readAll("vt_template_lines", TPLL, [["legal_entity_id", e]], parseTemplateLine),
  listMaterials: (e) => readAll("raw_materials", MAT, [["legal_entity_id", e]], parseMaterial),
  async listDepartments(e) {
    const rows = await readAll("production_departments", "id, display_name, status", [["legal_entity_id", e]], v => {
      const r = rec(v, "avdeling"); return { id: String(r.id), name: typeof r.display_name === "string" ? r.display_name : "", active: r.status === "active" };
    });
    return [...new Set(rows.filter(r => r.active && r.name.trim()).map(r => r.name.trim()))].sort((a, b) => a.localeCompare(b, "nb"));
  },
  listCounts: (e) => readAll("vt_counts", CNT, [["legal_entity_id", e]], parseCount),
  async getCount(e, id) {
    const counts = await readAll("vt_counts", CNT, [["legal_entity_id", e], ["id", id]], parseCount);
    if (counts.length !== 1) throw new Error("Tellingen finnes ikke.");
    const lists = await readAll("vt_count_lists", LST, [["legal_entity_id", e], ["count_id", id]], parseCountList);
    const lines = await readAll("vt_count_lines", LIN, [["legal_entity_id", e], ["count_id", id]], parseCountLine);
    const listIds = new Set(lists.map(l => l.id));
    if (lists.some(l => l.count_id !== id) || lines.some(l => l.count_id !== id || !listIds.has(l.count_list_id))) throw new Error("Inkonsistent telling.");
    return { count: counts[0], lists: lists.sort((a, b) => a.sort_order - b.sort_order), lines: lines.sort((a, b) => a.sort_order - b.sort_order || a.snap_name.localeCompare(b.snap_name, "nb")) };
  },
  checkCoverage: (e, ids, mode, date) => read(() => db.rpc("vt_check_coverage", { p_legal_entity_id: e, p_template_ids: ids, p_valuation_mode: mode, p_valuation_date: date }), parseCoverage),
  saveLocation: (i) => call(() => db.rpc("vt_save_location", { p_op_id: i.opId, p_legal_entity_id: i.entity, p_location_id: i.id, p_expected_revision: i.expectedRevision,
    p_department: i.department, p_name: i.name, p_sort_order: i.sortOrder, p_archived: i.archived }), d => parseLocationReceipt(d, i)),
  saveTemplate: (i) => call(() => db.rpc("vt_save_template", { p_op_id: i.opId, p_legal_entity_id: i.entity, p_template_id: i.id, p_expected_revision: i.expectedRevision,
    p_name: i.name, p_department: i.department, p_default_location_id: i.defaultLocationId, p_archived: i.archived, p_lines: i.lines }),
    d => parseTemplateReceipt(d, { id: i.id, expectedRevision: i.expectedRevision, lineCount: i.lines ? i.lines.length : null })),
  copyTemplate: (i) => call(() => db.rpc("vt_copy_template", { p_op_id: i.opId, p_legal_entity_id: i.entity, p_source_id: i.sourceId, p_expected_revision: i.expectedRevision, p_name: i.name }),
    d => parseTemplateReceipt(d, { id: null, expectedRevision: null, lineCount: null })),
  createCount: (i) => call(() => db.rpc("vt_create_count", { p_op_id: i.opId, p_legal_entity_id: i.entity, p_name: i.name, p_planned_date: i.plannedDate,
    p_valuation_mode: i.valuationMode, p_valuation_date: i.valuationDate, p_template_ids: i.templateIds }), d => parseCreateReceipt(d, i.templateIds)),
  startCount: (i) => call(() => db.rpc("vt_start_count", { p_op_id: i.opId, p_count_id: i.countId, p_expected_revision: i.expectedRevision }),
    d => parseStartReceipt(d, i.countId, i.expectedRevision)),
  saveLine: (i) => call(() => db.rpc("vt_save_line", { p_op_id: i.opId, p_line_id: i.lineId, p_expected_revision: i.expectedRevision, p_state: i.state,
    p_counted_base: i.countedBase, p_entry: i.entry, p_note: i.note }), d => parseSaveLine(d, i.lineId, i.expectedRevision)),
  setListStatus: (i) => call(() => db.rpc("vt_set_list_status", { p_op_id: i.opId, p_list_id: i.listId, p_expected_revision: i.expectedRevision, p_status: i.status }),
    d => parseListStatusReceipt(d, i.listId, i.expectedRevision, i.status)),
  transitionCount: (i) => call(() => db.rpc("vt_transition_count", { p_op_id: i.opId, p_count_id: i.countId, p_expected_revision: i.expectedRevision, p_to: i.to, p_reason: i.reason }),
    d => parseTransitionReceipt(d, i.countId, i.expectedRevision, i.to)),
};
