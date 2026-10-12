import { VtRejectedError, type VtApi } from "./api";
import type { VtCount, VtCountLine, VtCountList, VtLocation, VtMaterial, VtTemplate, VtTemplateLine } from "./types";

/**
 * Minnebasert, syntetisk implementasjon for forhåndsvisning og komponenttester.
 * Ingen nettverk. Speiler serverreglene (duplikatsperre, frosset grunnlag, CAS, op-id).
 */
export function createFakeVtApi(opts: { available?: boolean; today?: string; seed?: boolean } = {}): VtApi & { _state: FakeState } {
  const today = opts.today ?? "2026-10-12";
  const st: FakeState = { locations: [], templates: [], tlines: [], materials: [], counts: [], lists: [], lines: [], ops: new Map(), seq: 0, createOps: new Map(), startOps: new Map(), finishOps: new Map() };
  const id = (p: string) => `${p}-${++st.seq}`;
  const now = () => new Date(Date.UTC(2026, 9, 12, 8, 0, st.seq)).toISOString();
  const key = (m: string, l: string | null) => `${m}|${l ?? ""}`;

  if (opts.seed !== false) {
    st.materials = [
      { id: "m1", name: "Hvetemel (demo)", sku: "D-100", base_unit: "kg", stock_tracking: true, is_active: true, cost_basis_status: "verifisert" },
      { id: "m2", name: "Sukker (demo)", sku: "D-200", base_unit: "kg", stock_tracking: true, is_active: true, cost_basis_status: "mangler" },
      { id: "m3", name: "Smør usaltet (demo)", sku: "D-300", base_unit: "kg", stock_tracking: true, is_active: true, cost_basis_status: "verifisert" },
      { id: "m4", name: "Kakeesker 25 cm (demo)", sku: null, base_unit: "stk", stock_tracking: true, is_active: true, cost_basis_status: "verifisert" },
      { id: "m5", name: "Vaniljesukker med et veldig langt demonstrasjonsnavn for bryting", sku: "D-500", base_unit: "g", stock_tracking: true, is_active: true, cost_basis_status: null },
    ];
    st.prices = new Map([["m1", 12.5], ["m3", 98], ["m4", 4.2]]);
    st.units = new Map([["m1", [{ id: "u1", label: "sekk 25 kg", units_in_base: 25 }]], ["m4", [{ id: "u4", label: "bunt 50 stk", units_in_base: 50 }]]]);
    st.locations = [
      { id: "l1", department: "Bakeri", name: "Tørrlager", sort_order: 0, archived_at: null },
      { id: "l2", department: "Bakeri", name: "Produksjon", sort_order: 1, archived_at: null },
      { id: "l3", department: "Butikk", name: "Lager bak disk", sort_order: 2, archived_at: null },
    ];
    st.templates = [
      { id: "t1", name: "Tørrlager (demo)", department: "Bakeri", default_location_id: "l1", revision: 3, archived_at: null, updated_at: "2026-10-10T09:00:00Z" },
      { id: "t2", name: "Produksjon (demo)", department: "Bakeri", default_location_id: "l2", revision: 2, archived_at: null, updated_at: "2026-10-11T09:00:00Z" },
    ];
    st.tlines = [
      { id: "tl1", template_id: "t1", raw_material_id: "m1", location_id: "l1", sort_order: 1 },
      { id: "tl2", template_id: "t1", raw_material_id: "m2", location_id: "l1", sort_order: 2 },
      { id: "tl3", template_id: "t2", raw_material_id: "m1", location_id: "l2", sort_order: 1 },
      { id: "tl4", template_id: "t2", raw_material_id: "m3", location_id: "l2", sort_order: 2 },
    ];
  }
  const bump = (tid: string) => { const t = st.templates.find(x => x.id === tid); if (t) { t.revision++; t.updated_at = now(); } };
  const ensure = () => { if (opts.available === false) throw new VtRejectedError("Ikke tatt i bruk", "PGRST205"); };

  const api: VtApi & { _state: FakeState } = {
    _state: st,
    async probe() { return opts.available !== false; },
    async listLocations() { ensure(); return st.locations.map(x => ({ ...x })); },
    async createLocation(_e, department, name) {
      if (st.locations.some(l => !l.archived_at && l.department.trim().toLowerCase() === department.trim().toLowerCase() && l.name.trim().toLowerCase() === name.trim().toLowerCase())) throw new VtRejectedError("Stedet finnes allerede.", "23505");
      const l: VtLocation = { id: id("l"), department: department.trim(), name: name.trim(), sort_order: st.locations.length, archived_at: null };
      st.locations.push(l); return { ...l };
    },
    async archiveLocation(_e, lid) { const l = st.locations.find(x => x.id === lid); if (l) l.archived_at = now(); },
    async listTemplates() { ensure(); return st.templates.map(x => ({ ...x })); },
    async listTemplateLines() { ensure(); return st.tlines.map(x => ({ ...x })); },
    async createTemplate(_e, name, department, loc) {
      if (st.templates.some(t => !t.archived_at && t.name.trim().toLowerCase() === name.trim().toLowerCase())) throw new VtRejectedError("En listemal med samme navn finnes.", "23505");
      const t: VtTemplate = { id: id("t"), name: name.trim(), department: department.trim(), default_location_id: loc, revision: 1, archived_at: null, updated_at: now() };
      st.templates.push(t); return { ...t };
    },
    async updateTemplate(_e, tid, p) {
      const t = st.templates.find(x => x.id === tid); if (!t) throw new VtRejectedError("Finnes ikke", "22023");
      if (p.name !== undefined) t.name = p.name.trim();
      if (p.department !== undefined) t.department = p.department.trim();
      if (p.archived !== undefined) t.archived_at = p.archived ? now() : null;
      t.updated_at = now();
    },
    async addTemplateLines(_e, tid, rows) {
      for (const r of rows) if (st.tlines.some(l => l.template_id === tid && key(l.raw_material_id, l.location_id) === key(r.raw_material_id, r.location_id))) throw new VtRejectedError("Samme vare og sted finnes allerede i listen.", "23505");
      for (const r of rows) { st.tlines.push({ id: id("tl"), template_id: tid, ...r }); bump(tid); }
    },
    async removeTemplateLine(_e, lid) { const i = st.tlines.findIndex(l => l.id === lid); if (i < 0) throw new VtRejectedError("Finnes ikke", "22023"); bump(st.tlines[i].template_id); st.tlines.splice(i, 1); },
    async listMaterials() { return st.materials.map(x => ({ ...x })); },
    async listCounts() { ensure(); return st.counts.map(c => ({ ...c })); },
    async getCount(_e, cid) {
      const c = st.counts.find(x => x.id === cid); if (!c) throw new Error("Finnes ikke");
      return { count: { ...c }, lists: st.lists.filter(l => l.count_id === cid).map(l => ({ ...l })), lines: st.lines.filter(l => l.count_id === cid).map(l => ({ ...l, entry: [...l.entry] })) };
    },
    async checkCoverage(_e, ids) {
      const sel = st.tlines.filter(l => ids.includes(l.template_id));
      const groups = new Map<string, VtTemplateLine[]>();
      for (const l of sel) groups.set(key(l.raw_material_id, l.location_id), [...(groups.get(key(l.raw_material_id, l.location_id)) ?? []), l]);
      return {
        duplicates: [...groups.values()].filter(g => g.length > 1).map(g => ({ raw_material_id: g[0].raw_material_id, location_id: g[0].location_id, template_ids: g.map(x => x.template_id) })),
        missing_price: new Set(sel.filter(l => !st.prices?.has(l.raw_material_id) || st.materials.find(m => m.id === l.raw_material_id)?.cost_basis_status !== "verifisert").map(l => l.raw_material_id)).size,
        missing_location: sel.filter(l => !l.location_id).length, line_count: sel.length,
      };
    },
    async createCount(i) {
      const prev = st.createOps.get(i.opId); if (prev) return { id: prev, repeated: true };
      if (i.templateIds.length === 0) throw new VtRejectedError("Velg minst én listemal", "22023");
      const c: VtCount = { id: id("c"), name: i.name.trim(), planned_date: i.plannedDate, valuation_date: i.valuationDate, status: "planlagt", template_ids: [...new Set(i.templateIds)], revision: 1, started_at: null, finished_at: null, cancel_reason: null, created_at: now() };
      st.counts.push(c); st.createOps.set(i.opId, c.id); return { id: c.id, repeated: false };
    },
    async startCount(i) {
      const c = st.counts.find(x => x.id === i.countId); if (!c) throw new VtRejectedError("Mangler tilgang", "42501");
      if (st.startOps.get(i.opId) === c.id) return { repeated: true, historic: c.valuation_date < today };
      if (c.status !== "planlagt") throw new VtRejectedError("Tellingen er allerede startet eller lukket", "55000");
      if (c.revision !== i.expectedRevision) throw new VtRejectedError("Endret av andre", "40001");
      const cov = await api.checkCoverage("", c.template_ids);
      if (cov.duplicates.length) throw new VtRejectedError("Samme vare på samme sted finnes i flere valgte lister — avklar før start", "23505");
      const historic = c.valuation_date < today; const at = now();
      c.template_ids.forEach((tid, n) => {
        const t = st.templates.find(x => x.id === tid); if (!t) return;
        const list: VtCountList = { id: id("cl"), count_id: c.id, source_template_id: t.id, source_template_revision: t.revision, name: t.name, department: t.department, status: "ikke_startet", sort_order: n + 1 };
        st.lists.push(list);
        for (const tl of st.tlines.filter(x => x.template_id === tid)) {
          const m = st.materials.find(x => x.id === tl.raw_material_id); if (!m) continue;
          const loc = st.locations.find(x => x.id === tl.location_id);
          const p = m.cost_basis_status === "verifisert" ? st.prices?.get(m.id) ?? null : null;
          st.lines.push({
            id: id("ln"), count_id: c.id, count_list_id: list.id, raw_material_id: m.id, location_id: tl.location_id, sort_order: tl.sort_order,
            snap_name: m.name, snap_sku: m.sku, snap_location_name: loc ? `${loc.department} / ${loc.name}` : null, snap_base_unit: m.base_unit ?? "stk",
            snap_units: (st.units?.get(m.id) ?? []).map(u => ({ ...u })), snap_price_per_base: historic ? null : p,
            snap_price_source: historic ? "historisk_ikke_tilgjengelig" : p != null ? "verifisert_kostpris" : "mangler_verifisert_pris",
            snap_currency: "NOK", snap_taken_at: at, state: "ikke_talt", counted_base: null, entry: [], note: null, revision: 0, updated_at: at,
          });
        }
      });
      c.status = "pagar"; c.started_at = at; c.revision++; st.startOps.set(i.opId, c.id);
      return { repeated: false, historic };
    },
    async saveLine(i) {
      const prev = st.ops.get(i.opId); if (prev) return { kind: "saved", line: { ...prev }, alreadyApplied: true };
      const l = st.lines.find(x => x.id === i.lineId); if (!l) throw new VtRejectedError("Mangler tilgang", "42501");
      const c = st.counts.find(x => x.id === l.count_id); const list = st.lists.find(x => x.id === l.count_list_id);
      if (!c || !["pagar", "til_kontroll"].includes(c.status) || list?.status === "godkjent") throw new VtRejectedError("Listen er ikke åpen for registrering", "55000");
      if (l.revision !== i.expectedRevision) return { kind: "conflict", current: { ...l } };
      if (i.state === "talt" && (i.countedBase == null || i.countedBase < 0)) throw new VtRejectedError("Ugyldig mengde", "23514");
      Object.assign(l, { state: i.state, counted_base: i.state === "null" ? 0 : i.state === "ikke_talt" || i.state === "ikke_her" ? null : i.countedBase, entry: i.entry, note: i.note?.trim() || null, revision: l.revision + 1, updated_at: now() });
      if (list && list.status === "ikke_startet") list.status = "under_telling";
      st.ops.set(i.opId, { ...l }); return { kind: "saved", line: { ...l }, alreadyApplied: false };
    },
    async setListStatus(lid, status) {
      const list = st.lists.find(x => x.id === lid); if (!list) throw new VtRejectedError("Mangler tilgang", "42501");
      if (status === "godkjent" && st.lines.some(l => l.count_list_id === lid && (l.state === "ikke_talt" || l.state === "ma_kontrolleres"))) throw new VtRejectedError("Listen har linjer som ikke er talt eller må kontrolleres", "55000");
      list.status = status;
    },
    async transitionCount(i) {
      const c = st.counts.find(x => x.id === i.countId); if (!c) throw new VtRejectedError("Mangler tilgang", "42501");
      if (st.finishOps.get(i.opId) === c.id) return { repeated: true };
      if (c.revision !== i.expectedRevision) throw new VtRejectedError("Endret av andre", "40001");
      const ls = st.lines.filter(l => l.count_id === c.id);
      if (i.to === "avsluttet") {
        if (ls.some(l => l.state === "ikke_talt" || l.state === "ma_kontrolleres")) throw new VtRejectedError("Linjer er ikke talt eller må kontrolleres", "55000");
        if (ls.some(l => (l.state === "talt" || l.state === "null") && l.snap_price_per_base == null)) throw new VtRejectedError("Verdien er ufullstendig: talte varer mangler dokumentert pris", "55000");
        c.finished_at = now();
      }
      if (i.to === "avbrutt") { if (!i.reason || i.reason.trim().length < 3) throw new VtRejectedError("Begrunnelse kreves", "22023"); c.cancel_reason = i.reason.trim(); }
      c.status = i.to; c.revision++;
      if (i.to === "avsluttet" || i.to === "avbrutt") st.finishOps.set(i.opId, c.id);
      return { repeated: false };
    },
  };
  return api;
}

export interface FakeState {
  locations: VtLocation[]; templates: VtTemplate[]; tlines: VtTemplateLine[]; materials: VtMaterial[];
  counts: VtCount[]; lists: VtCountList[]; lines: VtCountLine[]; ops: Map<string, VtCountLine>; seq: number;
  createOps: Map<string, string>; startOps: Map<string, string>; finishOps: Map<string, string>;
  prices?: Map<string, number>; units?: Map<string, { id: string; label: string; units_in_base: number }[]>;
}
