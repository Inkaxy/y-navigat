import { createContext, useContext } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  parseCount, parseCountLine, parseCountList, parseCoverage, parseLocation, parseMaterial, parseOkId,
  parseSaveLine, parseTemplate, parseTemplateLine,
  type Coverage, type EntryPart, type LineState, type SaveLineResult, type VtCount, type VtCountLine,
  type VtCountList, type VtLocation, type VtMaterial, type VtTemplate, type VtTemplateLine,
} from "./types";

/** Ukjent utfall (nett/uventet svar): kan ha blitt lagret. Gjenta med SAMME operasjons-ID. */
export class VtUnknownOutcomeError extends Error {
  constructor() { super("Vi vet ikke om endringen ble lagret. Prøv igjen — samme registrering sendes på nytt."); }
}
/** Serveren avviste med kjent grunn; ingenting ble skrevet. */
export class VtRejectedError extends Error {
  constructor(message: string, readonly code: string | null) { super(message); }
}
/** Tabellene/funksjonene er ikke rullet ut i databasen ennå. */
export class VtBackendUnavailableError extends Error {
  constructor() { super("Det nye tellesystemet er ikke tatt i bruk i databasen ennå."); }
}

export interface VtApi {
  /** true = rullet ut, false = ikke rullet ut. Kaster ved annen feil. */
  probe(entity: string): Promise<boolean>;
  listLocations(entity: string): Promise<VtLocation[]>;
  createLocation(entity: string, department: string, name: string): Promise<VtLocation>;
  archiveLocation(entity: string, id: string): Promise<void>;
  listTemplates(entity: string): Promise<VtTemplate[]>;
  listTemplateLines(entity: string): Promise<VtTemplateLine[]>;
  createTemplate(entity: string, name: string, department: string, defaultLocationId: string | null): Promise<VtTemplate>;
  updateTemplate(entity: string, id: string, patch: { name?: string; department?: string; archived?: boolean }): Promise<void>;
  addTemplateLines(entity: string, templateId: string, rows: { raw_material_id: string; location_id: string | null; sort_order: number }[]): Promise<void>;
  removeTemplateLine(entity: string, id: string): Promise<void>;
  listMaterials(entity: string): Promise<VtMaterial[]>;
  listCounts(entity: string): Promise<VtCount[]>;
  getCount(entity: string, id: string): Promise<{ count: VtCount; lists: VtCountList[]; lines: VtCountLine[] }>;
  checkCoverage(entity: string, templateIds: string[]): Promise<Coverage>;
  createCount(input: { opId: string; entity: string; name: string; plannedDate: string; valuationDate: string; templateIds: string[] }): Promise<{ id: string; repeated: boolean }>;
  startCount(input: { opId: string; countId: string; expectedRevision: number }): Promise<{ repeated: boolean; historic: boolean }>;
  saveLine(input: { opId: string; lineId: string; expectedRevision: number; state: LineState; countedBase: number | null; entry: EntryPart[]; note: string | null }): Promise<SaveLineResult>;
  setListStatus(listId: string, status: "under_telling" | "til_kontroll" | "godkjent"): Promise<void>;
  transitionCount(input: { opId: string; countId: string; expectedRevision: number; to: "til_kontroll" | "pagar" | "avsluttet" | "avbrutt"; reason: string | null }): Promise<{ repeated: boolean }>;
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

function rejectOrUnknown(e: PgErr): Error {
  const code = e?.code ?? null;
  if (code && MISSING.has(code)) return new VtBackendUnavailableError();
  if (code === "42501") return new VtRejectedError("Du mangler tilgang til denne handlingen.", code);
  if (code === "23505") return new VtRejectedError("Finnes allerede (samme vare og sted, eller samme navn).", code);
  if (code === "40001") return new VtRejectedError("Endret av andre i mellomtiden. Last inn på nytt.", code);
  if (code === "55000") return new VtRejectedError(serverText(e?.message) ?? "Handlingen er ikke tillatt i denne statusen.", code);
  if (code === "22023" || code === "23514") return new VtRejectedError(serverText(e?.message) ?? "Ugyldige verdier.", code);
  return new VtUnknownOutcomeError();
}
/** Bare egne, norske servermeldinger vises; aldri rå tekniske feil. */
function serverText(m: string | undefined): string | null {
  return m && /[æøåÆØÅ]|telling|liste|linje|pris|mal/i.test(m) && m.length < 160 ? m : null;
}
async function call<T>(fn: () => PromiseLike<{ data: unknown; error: PgErr }>, parse: (d: unknown) => T): Promise<T> {
  let r: { data: unknown; error: PgErr };
  try { r = await fn(); } catch { throw new VtUnknownOutcomeError(); }
  if (r.error) throw rejectOrUnknown(r.error);
  try { return parse(r.data); } catch { throw new VtUnknownOutcomeError(); }
}
async function read<T>(fn: () => PromiseLike<{ data: unknown; error: PgErr }>, parse: (d: unknown) => T): Promise<T> {
  const r = await fn();
  if (r.error) throw r.error.code && MISSING.has(r.error.code) ? new VtBackendUnavailableError() : new Error("Kunne ikke hente data.");
  return parse(r.data);
}
const arr = <T,>(p: (v: unknown) => T) => (d: unknown): T[] => { if (!Array.isArray(d)) throw new Error("liste"); return d.map(p); };

/** Henter alle sider med eksakt antall; kort side alene beviser ikke slutt. */
async function readAll<T extends { id: string }>(table: string, cols: string, entity: string, parse: (v: unknown) => T, filter?: [string, string]): Promise<T[]> {
  let head = db.from(table).select("id", { count: "exact", head: true }).eq("legal_entity_id", entity);
  if (filter) head = head.eq(filter[0], filter[1]);
  const h = await head;
  if (h.error) throw h.error.code && MISSING.has(h.error.code) ? new VtBackendUnavailableError() : new Error("Kunne ikke hente data.");
  const expected = h.count;
  if (typeof expected !== "number") throw new Error("Ukjent antall");
  const out: T[] = [];
  let last: string | null = null;
  while (out.length < expected) {
    let q = db.from(table).select(cols).eq("legal_entity_id", entity);
    if (filter) q = q.eq(filter[0], filter[1]);
    if (last) q = q.gt("id", last);
    const r = await q.order("id").limit(500);
    if (r.error || !Array.isArray(r.data)) throw new Error("Kunne ikke hente data.");
    if (r.data.length === 0) throw new Error("Ufullstendig henting");
    for (const row of r.data) out.push(parse(row));
    last = out[out.length - 1].id;
  }
  return out;
}

const LOC = "id, department, name, sort_order, archived_at";
const TPL = "id, name, department, default_location_id, revision, archived_at, updated_at";
const TPLL = "id, template_id, raw_material_id, location_id, sort_order";
const CNT = "id, name, planned_date, valuation_date, status, template_ids, revision, started_at, finished_at, cancel_reason, created_at";
const LST = "id, count_id, source_template_id, source_template_revision, name, department, status, sort_order";
const LIN = "id, count_id, count_list_id, raw_material_id, location_id, sort_order, snap_name, snap_sku, snap_location_name, snap_base_unit, snap_units, snap_price_per_base, snap_price_source, snap_currency, snap_taken_at, state, counted_base, entry, note, revision, updated_at";

export const supabaseVtApi: VtApi = {
  async probe(entity) {
    const r = await db.from("vt_counts").select("id", { head: true, count: "exact" }).eq("legal_entity_id", entity);
    if (!r.error) return true;
    if (r.error.code && MISSING.has(r.error.code)) return false;
    throw new Error("Kunne ikke kontrollere tellesystemet.");
  },
  listLocations: (e) => readAll("vt_locations", LOC, e, parseLocation),
  createLocation: (e, department, name) => call(() => db.from("vt_locations").insert({ legal_entity_id: e, department: department.trim(), name: name.trim() }).select(LOC).single(), parseLocation),
  archiveLocation: (e, id) => call(() => db.from("vt_locations").update({ archived_at: new Date().toISOString() }).eq("id", id).eq("legal_entity_id", e).select("id").single(), () => undefined),
  listTemplates: (e) => readAll("vt_templates", TPL, e, parseTemplate),
  listTemplateLines: (e) => readAll("vt_template_lines", TPLL, e, parseTemplateLine),
  createTemplate: (e, name, department, loc) => call(() => db.from("vt_templates").insert({ legal_entity_id: e, name: name.trim(), department: department.trim(), default_location_id: loc }).select(TPL).single(), parseTemplate),
  updateTemplate: (e, id, p) => call(() => db.from("vt_templates").update({
    ...(p.name !== undefined ? { name: p.name.trim() } : {}),
    ...(p.department !== undefined ? { department: p.department.trim() } : {}),
    ...(p.archived !== undefined ? { archived_at: p.archived ? new Date().toISOString() : null } : {}),
  }).eq("id", id).eq("legal_entity_id", e).select("id").single(), () => undefined),
  addTemplateLines: (e, templateId, rows) => call(() => db.from("vt_template_lines").insert(rows.map(r => ({ ...r, template_id: templateId, legal_entity_id: e }))).select("id"),
    (d) => { if (!Array.isArray(d) || d.length !== rows.length) throw new Error("kvittering"); }),
  removeTemplateLine: (e, id) => call(() => db.from("vt_template_lines").delete().eq("id", id).eq("legal_entity_id", e).select("id"),
    (d) => { if (!Array.isArray(d) || d.length !== 1) throw new Error("kvittering"); }),
  listMaterials: (e) => readAll("raw_materials", "id, name, sku, base_unit, stock_tracking, is_active, cost_basis_status", e, parseMaterial),
  listCounts: (e) => readAll("vt_counts", CNT, e, parseCount),
  async getCount(e, id) {
    const count = await read(() => db.from("vt_counts").select(CNT).eq("id", id).eq("legal_entity_id", e).single(), parseCount);
    const lists = await read(() => db.from("vt_count_lists").select(LST).eq("count_id", id).eq("legal_entity_id", e).order("sort_order"), arr(parseCountList));
    const lines = await readAll("vt_count_lines", LIN, e, parseCountLine, ["count_id", id]);
    lines.sort((a, b) => a.sort_order - b.sort_order || a.snap_name.localeCompare(b.snap_name, "nb"));
    return { count, lists, lines };
  },
  checkCoverage: (e, ids) => read(() => db.rpc("vt_check_coverage", { p_legal_entity_id: e, p_template_ids: ids }), parseCoverage),
  createCount: (i) => call(() => db.rpc("vt_create_count", { p_op_id: i.opId, p_legal_entity_id: i.entity, p_name: i.name, p_planned_date: i.plannedDate, p_valuation_date: i.valuationDate, p_template_ids: i.templateIds }),
    (d) => { const r = parseOkId(d, "count_id"); return { id: r.id, repeated: r.repeated }; }),
  startCount: (i) => call(() => db.rpc("vt_start_count", { p_op_id: i.opId, p_count_id: i.countId, p_expected_revision: i.expectedRevision }),
    (d) => { const r = parseOkId(d, "count_id", i.countId); return { repeated: r.repeated, historic: r.raw.historic_valuation === true }; }),
  saveLine: (i) => call(() => db.rpc("vt_save_line", { p_op_id: i.opId, p_line_id: i.lineId, p_expected_revision: i.expectedRevision, p_state: i.state, p_counted_base: i.countedBase, p_entry: i.entry, p_note: i.note }),
    (d) => parseSaveLine(d, i.lineId)),
  setListStatus: (id, status) => call(() => db.rpc("vt_set_list_status", { p_list_id: id, p_status: status }), (d) => { parseOkId(d, "list_id", id); }),
  transitionCount: (i) => call(() => db.rpc("vt_transition_count", { p_op_id: i.opId, p_count_id: i.countId, p_expected_revision: i.expectedRevision, p_to: i.to, p_reason: i.reason }),
    (d) => ({ repeated: parseOkId(d, "count_id", i.countId).repeated })),
};
