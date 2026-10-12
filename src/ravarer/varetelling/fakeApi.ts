import { VtRejectedError, VtUnknownOutcomeError, type VtApi } from "./api";
import { entryToBase } from "./logic";
import type { BaseUnit, EntryPart, PriceSource, SnapUnit, VtCount, VtCountLine, VtCountList, VtLocation, VtMaterial, VtTemplate, VtTemplateLine } from "./types";

/**
 * Minnebasert, syntetisk implementasjon for forhåndsvisning og komponenttester. Ingen nettverk.
 * Speiler serverreglene i SQL-revisjon 2 (op-kvitteringer, CAS, serverberegnet mengde, låste lister).
 * Pris: bare «bundet» syntetisk pris; ellers mangler med årsak — aldri en gjettet pris.
 */
export interface FakeState {
  locations: VtLocation[]; templates: VtTemplate[]; tlines: VtTemplateLine[]; materials: VtMaterial[];
  counts: VtCount[]; lists: VtCountList[]; lines: VtCountLine[]; seq: number;
  ops: Map<string, { sig: string; result: unknown }>;
  prices: Map<string, { price: number; historyId: string; effective: string }>;
  units: Map<string, SnapUnit[]>;
  /** Neste kall kaster ukjent utfall ETTER å ha utført (simulerer tapt svar). */
  loseNextResponse: boolean;
  /** Linjer med godkjent prisavklaring (satt av syntetisk trinn 3). */
  clarified: Set<string>;
}
const BASE: readonly string[] = ["kg", "g", "l", "ml", "stk"];
const isBase = (u: string | null): u is BaseUnit => u !== null && BASE.includes(u);

export function createFakeVtApi(opts: { available?: boolean; today?: string; seed?: boolean } = {}): VtApi & { _state: FakeState } {
  const today = opts.today ?? "2026-10-12";
  const st: FakeState = { locations: [], templates: [], tlines: [], materials: [], counts: [], lists: [], lines: [], seq: 0, ops: new Map(), prices: new Map(), units: new Map(), loseNextResponse: false, clarified: new Set() };
  const id = (p: string) => `${p}-${++st.seq}`;
  const now = () => new Date(Date.UTC(2026, 9, 12, 8, 0, st.seq)).toISOString();
  const key = (m: string, l: string | null) => `${m}|${l ?? ""}`;
  const mat = (i: string, name: string, sku: string | null, base: string | null, cat: string, tracking = false, active = true): VtMaterial =>
    ({ id: i, name, sku, base_unit: base, stock_tracking: tracking, is_active: active, category: cat, categories: [] });

  if (opts.seed !== false) {
    st.materials = [
      mat("m1", "Hvetemel (demo)", "D-100", "kg", "Mel", true), mat("m2", "Sukker (demo)", "D-200", "kg", "Sukker"),
      mat("m3", "Smør usaltet (demo)", "D-300", "kg", "Meieri"), mat("m4", "Kakeesker 25 cm (demo)", null, "stk", "Emballasje"),
      mat("m5", "Vaniljesukker med et veldig langt demonstrasjonsnavn for bryting", "D-500", "pose", "Sukker"),
      mat("m6", "Rug (demo)", "D-600", "kg", "Mel"), mat("m7", "Gammel vare (demo)", "D-700", "kg", "Mel", false, false),
    ];
    st.prices = new Map([["m1", { price: 12.5, historyId: "h1", effective: "2026-10-01" }], ["m3", { price: 98, historyId: "h3", effective: "2026-09-20" }], ["m4", { price: 4.2, historyId: "h4", effective: "2026-08-02" }]]);
    st.units = new Map([["m1", [{ id: "u1", label: "sekk 25 kg", units_in_base: 25 }]], ["m4", [{ id: "u4", label: "bunt 50 stk", units_in_base: 50 }]]]);
    st.locations = [
      { id: "l1", department: "Bakeri", name: "Tørrlager", sort_order: 0, revision: 1, archived_at: null },
      { id: "l2", department: "Bakeri", name: "Produksjon", sort_order: 1, revision: 1, archived_at: null },
      { id: "l3", department: "Butikk", name: "Lager bak disk", sort_order: 2, revision: 1, archived_at: null },
    ];
    st.templates = [
      { id: "t1", name: "Tørrlager (demo)", department: "Bakeri", default_location_id: "l1", revision: 3, archived_at: null, updated_at: "2026-10-10T09:00:00Z" },
      { id: "t2", name: "Produksjon (demo)", department: "Bakeri", default_location_id: "l2", revision: 2, archived_at: null, updated_at: "2026-10-11T09:00:00Z" },
    ];
    st.tlines = [
      { id: "tl1", template_id: "t1", raw_material_id: "m1", location_id: "l1", sort_order: 1, count_unit_ids: [] },
      { id: "tl2", template_id: "t1", raw_material_id: "m2", location_id: "l1", sort_order: 2, count_unit_ids: [] },
      { id: "tl3", template_id: "t2", raw_material_id: "m1", location_id: "l2", sort_order: 1, count_unit_ids: [] },
      { id: "tl4", template_id: "t2", raw_material_id: "m3", location_id: "l2", sort_order: 2, count_unit_ids: [] },
    ];
  }
  const ensure = () => { if (opts.available === false) throw new VtRejectedError("Ikke tatt i bruk", "PGRST205"); };
  /** Op-kvittering: samme op + samme innhold = lagret svar; annet innhold = 23505. */
  function op<T>(opId: string, sig: unknown, fn: () => T): T {
    const s = JSON.stringify(sig); const prev = st.ops.get(opId);
    if (prev) { if (prev.sig !== s) throw new VtRejectedError("Operasjons-ID er brukt med annet innhold", "23505"); return withReplay(prev.result) as T; }
    const result = fn();
    st.ops.set(opId, { sig: s, result });
    if (st.loseNextResponse) { st.loseNextResponse = false; throw new VtUnknownOutcomeError(); }
    return result;
  }
  const withReplay = (r: unknown) => (typeof r === "object" && r !== null && "replayed" in r ? { ...r, replayed: true } : r);
  const tplOut = (t: VtTemplate) => ({ template: { ...t }, lineCount: st.tlines.filter(l => l.template_id === t.id).length, replayed: false });
  const priceFor = (m: VtMaterial, historic: boolean): { price: number | null; source: PriceSource; reason: string | null; hid: string | null; eff: string | null } => {
    if (!isBase(m.base_unit)) return { price: null, source: "mangler_pris", reason: "enhet_ukjent", hid: null, eff: null };
    const p = st.prices.get(m.id);
    if (!p) return { price: null, source: "mangler_pris", reason: "ingen_dokumentert_pris", hid: null, eff: null };
    return { price: p.price, source: historic ? "historisk_dokumentert" : "dokumentert_kostpris", reason: null, hid: p.historyId, eff: p.effective };
  };

  const api: VtApi & { _state: FakeState } = {
    _state: st,
    async probe() { return opts.available === false ? "missing" : "ok"; },
    async listLocations() { ensure(); return st.locations.map(x => ({ ...x })); },
    async listTemplates() { ensure(); return st.templates.map(x => ({ ...x })); },
    async listTemplateLines() { ensure(); return st.tlines.map(x => ({ ...x, count_unit_ids: [...x.count_unit_ids] })); },
    async listMaterials() { return st.materials.map(x => ({ ...x })); },
    async listDepartments() { return ["Bakeri", "Butikk", "Konditori"]; },
    async listCounts() { ensure(); return st.counts.map(c => ({ ...c })); },
    async getCount(_e, cid) {
      const c = st.counts.find(x => x.id === cid); if (!c) throw new Error("Finnes ikke");
      return { count: { ...c }, lists: st.lists.filter(l => l.count_id === cid).map(l => ({ ...l })).sort((a, b) => a.sort_order - b.sort_order),
        lines: st.lines.filter(l => l.count_id === cid).map(l => ({ ...l, entry: [...l.entry] })) };
    },
    async checkCoverage(_e, ids, mode, date) {
      const sel = st.tlines.filter(l => ids.includes(l.template_id));
      const groups = new Map<string, VtTemplateLine[]>();
      for (const l of sel) groups.set(key(l.raw_material_id, l.location_id), [...(groups.get(key(l.raw_material_id, l.location_id)) ?? []), l]);
      const mats = [...new Set(sel.map(l => l.raw_material_id))].map(i => st.materials.find(m => m.id === i)).filter((m): m is VtMaterial => !!m);
      const ev = mats.map(m => priceFor(m, mode === "historisk"));
      const reasons: Record<string, number> = {};
      for (const e of ev) if (e.reason) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
      return {
        as_of: mode === "historisk" && date ? date : today, valuation_mode: mode, invoice_access: true,
        duplicates: [...groups.values()].filter(g => g.length > 1).map(g => ({ raw_material_id: g[0].raw_material_id, location_id: g[0].location_id, template_ids: g.map(x => x.template_id) })),
        line_count: sel.length, material_count: mats.length, missing_location: sel.filter(l => !l.location_id).length, archived_location: 0,
        empty_templates: ids.filter(t => !sel.some(l => l.template_id === t)).length,
        priced: ev.filter(e => e.price != null).length, missing_price: ev.filter(e => e.price == null).length, missing_price_by_reason: reasons,
        missing_unit: reasons.enhet_ukjent ?? 0, known_after_valuation: 0,
      };
    },
    async saveLocation(i) {
      return op(i.opId, ["loc", i.id, i.expectedRevision, i.department.trim(), i.name.trim(), i.sortOrder, i.archived], () => {
        const clash = st.locations.some(l => l.id !== i.id && !l.archived_at && l.department.trim().toLowerCase() === i.department.trim().toLowerCase() && l.name.trim().toLowerCase() === i.name.trim().toLowerCase());
        if (clash && !i.archived) throw new VtRejectedError("Stedet finnes allerede.", "23505");
        if (!i.id) {
          const l: VtLocation = { id: id("l"), department: i.department.trim(), name: i.name.trim(), sort_order: i.sortOrder, revision: 1, archived_at: null };
          st.locations.push(l); return { location: { ...l }, replayed: false };
        }
        const l = st.locations.find(x => x.id === i.id); if (!l) throw new VtRejectedError("Stedet finnes ikke", "22023");
        if (l.revision !== i.expectedRevision) throw new VtRejectedError("Stedet er endret av andre", "40001");
        Object.assign(l, { department: i.department.trim(), name: i.name.trim(), sort_order: i.sortOrder, archived_at: i.archived ? now() : null, revision: l.revision + 1 });
        return { location: { ...l }, replayed: false };
      });
    },
    async saveTemplate(i) {
      return op(i.opId, ["tpl", i.id, i.expectedRevision, i.name.trim(), i.department.trim(), i.defaultLocationId, i.archived, i.lines], () => {
        if (i.lines) {
          const seen = new Set<string>();
          for (const r of i.lines) {
            const k = key(r.raw_material_id, r.location_id);
            if (seen.has(k)) throw new VtRejectedError("Samme vare og sted finnes to ganger i listen", "23505");
            seen.add(k);
            if (r.location_id && !st.locations.some(l => l.id === r.location_id && !l.archived_at)) throw new VtRejectedError("Stedet finnes ikke i firmaet eller er arkivert", "22023");
            const m = st.materials.find(x => x.id === r.raw_material_id);
            const had = i.id && st.tlines.some(l => l.template_id === i.id && l.raw_material_id === r.raw_material_id);
            if (!m || (!m.is_active && !had)) throw new VtRejectedError("Varen tilhører ikke firmaet eller er inaktiv", "22023");
          }
        }
        if (st.templates.some(t => t.id !== i.id && !t.archived_at && t.name.trim().toLowerCase() === i.name.trim().toLowerCase())) throw new VtRejectedError("En listemal med samme navn finnes.", "23505");
        let t: VtTemplate;
        if (!i.id) { t = { id: id("t"), name: i.name.trim(), department: i.department.trim(), default_location_id: i.defaultLocationId, revision: 1, archived_at: null, updated_at: now() }; st.templates.push(t); }
        else {
          const found = st.templates.find(x => x.id === i.id); if (!found) throw new VtRejectedError("Listemalen finnes ikke", "22023");
          if (found.revision !== i.expectedRevision) throw new VtRejectedError("Listemalen er endret av andre", "40001");
          if (found.archived_at) throw new VtRejectedError("Arkivert listemal kan ikke endres", "55000");
          Object.assign(found, { name: i.name.trim(), department: i.department.trim(), default_location_id: i.defaultLocationId, archived_at: i.archived ? now() : null, revision: found.revision + 1, updated_at: now() });
          t = found;
        }
        if (i.lines) {
          st.tlines = st.tlines.filter(l => l.template_id !== t.id);
          i.lines.forEach((r, n) => st.tlines.push({ id: id("tl"), template_id: t.id, raw_material_id: r.raw_material_id, location_id: r.location_id, sort_order: n + 1, count_unit_ids: [...r.count_unit_ids] }));
        }
        return tplOut(t);
      });
    },
    async copyTemplate(i) {
      return op(i.opId, ["copy", i.sourceId, i.expectedRevision, i.name.trim()], () => {
        const s = st.templates.find(x => x.id === i.sourceId); if (!s) throw new VtRejectedError("Listemalen finnes ikke", "22023");
        if (s.revision !== i.expectedRevision) throw new VtRejectedError("Listemalen er endret av andre", "40001");
        if (st.templates.some(t => !t.archived_at && t.name.trim().toLowerCase() === i.name.trim().toLowerCase())) throw new VtRejectedError("En listemal med samme navn finnes.", "23505");
        const t: VtTemplate = { id: id("t"), name: i.name.trim(), department: s.department, default_location_id: s.default_location_id, revision: 1, archived_at: null, updated_at: now() };
        st.templates.push(t);
        for (const l of st.tlines.filter(x => x.template_id === s.id)) st.tlines.push({ ...l, id: id("tl"), template_id: t.id, count_unit_ids: [...l.count_unit_ids] });
        return tplOut(t);
      });
    },
    async createCount(i) {
      const ids = [...i.templateIds].sort();
      return op(i.opId, ["create", i.name.trim(), i.plannedDate, i.valuationMode, i.valuationDate, ids], () => {
        if (ids.length === 0 || new Set(ids).size !== ids.length) throw new VtRejectedError("Velg 1–50 ulike listemaler", "22023");
        if (i.valuationMode === "ved_start" && i.valuationDate) throw new VtRejectedError("Verdsettelsesdato settes ved start", "22023");
        if (i.valuationMode === "historisk" && (!i.valuationDate || i.valuationDate >= today)) throw new VtRejectedError("Historisk verdsettelse krever en dato før i dag", "22023");
        const c: VtCount = { id: id("c"), name: i.name.trim(), planned_date: i.plannedDate, valuation_mode: i.valuationMode, valuation_date: i.valuationDate, status: "planlagt", template_ids: ids, revision: 1, started_at: null, finished_at: null, cancel_reason: null, created_at: now() };
        st.counts.push(c); return { countId: c.id, revision: 1, replayed: false };
      });
    },
    async startCount(i) {
      return op(i.opId, ["start", i.countId, i.expectedRevision], () => {
        const c = st.counts.find(x => x.id === i.countId); if (!c) throw new VtRejectedError("Mangler tilgang", "42501");
        if (c.status !== "planlagt") throw new VtRejectedError("Tellingen er allerede startet eller lukket", "55000");
        if (c.revision !== i.expectedRevision) throw new VtRejectedError("Tellingen er endret av andre", "40001");
        const sel = st.tlines.filter(l => c.template_ids.includes(l.template_id));
        if (c.template_ids.some(t => !sel.some(l => l.template_id === t))) throw new VtRejectedError("En valgt listemal har ingen varer", "22023");
        const seen = new Set<string>();
        for (const l of sel) { const k = key(l.raw_material_id, l.location_id); if (seen.has(k)) throw new VtRejectedError("Samme vare på samme sted finnes i flere valgte lister — avklar før start", "23505"); seen.add(k); }
        const historic = c.valuation_mode === "historisk"; const asOf = historic && c.valuation_date ? c.valuation_date : today; const at = now();
        const tpls = st.templates.filter(t => c.template_ids.includes(t.id)).sort((a, b) => a.department.localeCompare(b.department, "nb") || a.name.localeCompare(b.name, "nb"));
        tpls.forEach((t, n) => {
          const list: VtCountList = { id: id("cl"), count_id: c.id, source_template_id: t.id, source_template_revision: t.revision, name: t.name, department: t.department, status: "ikke_startet", revision: 1, sort_order: n + 1 };
          st.lists.push(list);
          for (const tl of st.tlines.filter(x => x.template_id === t.id)) {
            const m = st.materials.find(x => x.id === tl.raw_material_id); if (!m) continue;
            const loc = st.locations.find(x => x.id === tl.location_id);
            const p = priceFor(m, historic);
            const units = isBase(m.base_unit) ? (st.units.get(m.id) ?? []).filter(u => tl.count_unit_ids.length === 0 || tl.count_unit_ids.includes(u.id)).map(u => ({ ...u })) : [];
            st.lines.push({
              id: id("ln"), count_id: c.id, count_list_id: list.id, raw_material_id: m.id, location_id: tl.location_id, sort_order: tl.sort_order,
              snap_name: m.name, snap_sku: m.sku, snap_location_name: loc ? `${loc.department} / ${loc.name}` : null, snap_base_unit: isBase(m.base_unit) ? m.base_unit : null,
              snap_units: units, snap_price_per_base: p.price, snap_price_source: p.source, snap_price_reason: p.reason, snap_price_history_id: p.hid,
              snap_price_effective_date: p.eff, snap_price_as_of: asOf, snap_price_known_after_valuation: false,
              snap_currency: "NOK", snap_taken_at: at, state: "ikke_talt", counted_base: null, entry: [], note: null, revision: 0, updated_at: at,
            });
          }
        });
        c.status = "pagar"; c.started_at = at; c.valuation_date = asOf; c.revision++;
        const lines = st.lines.filter(l => l.count_id === c.id);
        return { revision: c.revision, listCount: tpls.length, lineCount: lines.length, pricedCount: lines.filter(l => l.snap_price_per_base != null).length, valuationMode: c.valuation_mode, valuationDate: asOf, replayed: false };
      });
    },
    async saveLine(i) {
      return op(i.opId, ["line", i.lineId, i.expectedRevision, i.state, i.countedBase, i.entry, i.note?.trim() || null], () => {
        const l = st.lines.find(x => x.id === i.lineId); if (!l) throw new VtRejectedError("Mangler tilgang", "42501");
        const c = st.counts.find(x => x.id === l.count_id); const list = st.lists.find(x => x.id === l.count_list_id);
        if (!c || !["pagar", "til_kontroll"].includes(c.status) || list?.status === "godkjent") throw new VtRejectedError("Listen er ikke åpen for registrering", "55000");
        const parts: EntryPart[] = [];
        const seen = new Set<string>();
        for (const e of i.entry) {
          if (!Number.isFinite(e.amount) || e.amount < 0 || e.amount > 1e9) throw new VtRejectedError("Ugyldig mengde", "22023");
          const k = e.unit_id ?? "base"; if (seen.has(k)) throw new VtRejectedError("Samme enhet to ganger", "22023"); seen.add(k);
          if (!l.snap_base_unit) throw new VtRejectedError("Varen mangler gyldig baseenhet — merk «Må kontrolleres» eller 0", "22023");
          const u = e.unit_id == null ? { id: null, label: l.snap_base_unit, units_in_base: 1 } : l.snap_units.find(x => x.id === e.unit_id);
          if (!u) throw new VtRejectedError("Ukjent telleenhet", "22023");
          parts.push({ unit_id: u.id, label: u.label, units_in_base: u.units_in_base, amount: e.amount });
        }
        const total = entryToBase(parts);
        if (i.state === "talt" && (total == null || total <= 0)) throw new VtRejectedError(total === 0 ? "Mengde 0: bruk «0 på lager»" : "Talt krever mengde", "22023");
        if ((i.state === "null" || i.state === "ikke_talt" || i.state === "ikke_her") && parts.length) throw new VtRejectedError("Tilstanden tar ikke mengde", "22023");
        const counted = i.state === "null" ? 0 : i.state === "ikke_talt" || i.state === "ikke_her" || parts.length === 0 ? null : total;
        if (counted != null && i.state !== "null" && (i.countedBase == null || Math.abs(i.countedBase - counted) > 1e-6 * Math.max(1, counted))) throw new VtRejectedError("Oppgitt sum stemmer ikke med registreringen", "22023");
        if (l.revision !== i.expectedRevision) return { kind: "conflict" as const, current: { ...l }, replayed: false };
        Object.assign(l, { state: i.state, counted_base: counted, entry: parts, note: i.note?.trim() || null, revision: l.revision + 1, updated_at: now() });
        if (list && list.status === "ikke_startet") { list.status = "under_telling"; list.revision++; }
        return { kind: "saved" as const, line: { ...l, entry: [...l.entry] }, replayed: false };
      });
    },
    async setListStatus(i) {
      return op(i.opId, ["list", i.listId, i.expectedRevision, i.status], () => {
        const list = st.lists.find(x => x.id === i.listId); if (!list) throw new VtRejectedError("Mangler tilgang", "42501");
        const c = st.counts.find(x => x.id === list.count_id);
        if (!c || !["pagar", "til_kontroll"].includes(c.status)) throw new VtRejectedError("Tellingen er ikke åpen", "55000");
        if (list.revision !== i.expectedRevision) throw new VtRejectedError("Listen er endret av andre", "40001");
        const ok = (i.status === "til_kontroll" && ["ikke_startet", "under_telling"].includes(list.status)) || (i.status === "under_telling" && ["til_kontroll", "godkjent"].includes(list.status)) || (i.status === "godkjent" && list.status === "til_kontroll");
        if (!ok) throw new VtRejectedError("Ugyldig listeovergang", "55000");
        if (i.status === "godkjent" && st.lines.some(l => l.count_list_id === list.id && (l.state === "ikke_talt" || l.state === "ma_kontrolleres"))) throw new VtRejectedError("Listen har linjer som ikke er talt eller må kontrolleres", "55000");
        list.status = i.status; list.revision++;
        return { revision: list.revision, replayed: false };
      });
    },
    async transitionCount(i) {
      return op(i.opId, ["tr", i.countId, i.expectedRevision, i.to, i.reason?.trim() || null], () => {
        const c = st.counts.find(x => x.id === i.countId); if (!c) throw new VtRejectedError("Mangler tilgang", "42501");
        if (c.revision !== i.expectedRevision) throw new VtRejectedError("Tellingen er endret av andre", "40001");
        const ls = st.lines.filter(l => l.count_id === c.id); const lists = st.lists.filter(l => l.count_id === c.id);
        if (i.to === "til_kontroll" && c.status !== "pagar") throw new VtRejectedError("Ugyldig overgang", "55000");
        if (i.to === "pagar" && c.status !== "til_kontroll") throw new VtRejectedError("Ugyldig overgang", "55000");
        if (i.to === "avsluttet") {
          if (!["pagar", "til_kontroll"].includes(c.status)) throw new VtRejectedError("Ugyldig overgang", "55000");
          if (ls.length === 0) throw new VtRejectedError("Tom telling kan ikke avsluttes", "55000");
          if (lists.some(l => l.status !== "godkjent" || !ls.some(x => x.count_list_id === l.id))) throw new VtRejectedError("Alle lister må ha varer og være godkjent", "55000");
          if (ls.some(l => l.state === "ikke_talt" || l.state === "ma_kontrolleres")) throw new VtRejectedError("Linjer er ikke talt eller må kontrolleres", "55000");
          if (ls.some(l => l.state === "talt" && l.snap_price_per_base == null && !st.clarified.has(l.id))) throw new VtRejectedError("Verdien er ufullstendig: talte varer mangler dokumentert eller avklart pris", "55000");
          c.finished_at = now();
        }
        if (i.to === "avbrutt") {
          if (!["planlagt", "pagar", "til_kontroll"].includes(c.status)) throw new VtRejectedError("Ugyldig overgang", "55000");
          if (!i.reason || i.reason.trim().length < 3) throw new VtRejectedError("Begrunnelse kreves", "22023");
          c.cancel_reason = i.reason.trim();
        }
        c.status = i.to; c.revision++;
        return { revision: c.revision, replayed: false };
      });
    },
  };
  return api;
}
