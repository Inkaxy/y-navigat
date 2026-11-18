// «Nullstill køen» – regelmotoren (bestilling 18.11.2026). Ren logikk: samme hjelpere som Nye varer bruker for navn, varetype,
// pakning og regnestykke, så resultatet blir som ved manuell behandling. Ingenting her skriver data.
import { lineMath } from "@/ravarer/lib/fraFaktura/lineMath";
import {
  baseUnitForNew, cleanItemName, guessItemType, isCreditLine, isNewItemType, nameSimilarity, packagePayload, packageProposal,
  pricePerBase, readPackage, SUGGEST_MIN, type PackageDraft, type PackageState,
} from "@/ravarer/lib/fraFaktura/newItems";
import {
  CLOSE_REASON_LABEL, CLOSE_TEXT, MAX_PRICE_PCT, NEW_ITEM_CATEGORY, NOT_ITEM_KINDS, PACKAGE_GUARD, PACKAGE_REASONS, PRICE_REASONS, RULES,
  type Catalog, type CatalogLink, type CloseReason, type CostChange, type Creation, type LeftOpen, type Plan, type PlanItem, type Rule, type RuleTotals,
  type SnapLine, type SupplierTotals,
} from "./types";

type Valid = Extract<PackageState, { state: "valid" }>;
const reasonsOf = (l: SnapLine) => (l.review_reason ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const byOldest = (a: SnapLine, b: SnapLine) => (a.invoice_date ?? "9999").localeCompare(b.invoice_date ?? "9999") || a.line_id.localeCompare(b.line_id);
const fmtKr = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ren lesing: lesekontrollen (delt `lineReadIssues` via lineMath), lagret lesevarsel, serverens lesekontroll og uavklart beløp. */
export function readClean(l: SnapLine): boolean {
  if (l.read_issue) return false;
  if (reasonsOf(l).includes("extraction_unresolved")) return false;
  return lineMath({ ...l, is_credit_note: l.is_credit_note }).clean;
}

/**
 * Pakning lest entydig av linjen: lest pakning (package_size/count_per_package) eller fakturert i grunnenhet (kg/l/stk …).
 * For en koblet vare: er linjen fakturert per stk mens varen har grunnenhet kg/l, brukes den trykte pakningen (4 l per stk)
 * når den passer grunnenheten – aldri varenavnet.
 */
export function readablePackage(l: SnapLine, baseUnit: string | null = null): PackageDraft | null {
  const d = packageProposal(l, null, lineMath(l));
  if (d.source === "direkte" && baseUnit && readPackage(d, baseUnit).state !== "valid") {
    const printed = packageProposal({ ...l, unit: null }, null, null);
    if (printed.source === "lest" && !printed.conflict && readPackage(printed, baseUnit).state === "valid") return { ...printed, container: d.container };
  }
  return (d.source === "lest" || d.source === "direkte") && !d.conflict ? d : null;
}

const samePackage = (a: Valid, b: Valid) => a.direct === b.direct && Math.abs(a.baseUnitsPerPackage - b.baseUnitsPerPackage) <= Math.max(1e-6, 0.001 * b.baseUnitsPerPackage);

export function linePricePerBase(l: SnapLine, s: Valid): number | null {
  const m = lineMath(l);
  return pricePerBase(l, s, m.units);
}

/** Regel 3-vakten: innenfor ±20 % av gjeldende kostpris, eller varen har ingen kostpris. */
export function withinPackageGuard(ppb: number, cost: number | null): boolean {
  if (!fin(cost) || cost <= 0) return true;
  return Math.abs(ppb / cost - 1) <= PACKAGE_GUARD + 1e-9;
}

function otherReason(reasons: string[]): CloseReason {
  if (reasons.includes("recalculation_pending")) return "beregnes_pa_nytt";
  if (reasons.includes("extraction_unresolved")) return "uavklart_belop";
  if (reasons.includes("extraction_issue")) return "lesevarsel";
  return "annen_arsak";
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

interface Ctx { cat: Catalog; items: PlanItem[]; closes: Map<string, { line: SnapLine; reason: CloseReason; detail: string | null }>; planned: Map<string, string[]> }

function base(rule: Rule, action: PlanItem["action"], lines: SnapLine[], extra: Partial<PlanItem> = {}): PlanItem {
  const first = [...lines].sort(byOldest)[0];
  return {
    rule, action, supplier_id: first.supplier_id, supplier_name: first.supplier_name, item_key: first.item_key,
    raw_material_id: null, raw_material_name: null, line_ids: lines.map((l) => l.line_id).sort(),
    invoice_ids: [...new Set(lines.map((l) => l.invoice_id))], reason_code: null, detail: null, prices: [],
    payload: { title: first.description ?? first.item_key ?? "", supplier_name: first.supplier_name }, ...extra,
  };
}
const close = (c: Ctx, l: SnapLine, reason: CloseReason, detail: string | null = null) => { if (!c.closes.has(l.line_id)) c.closes.set(l.line_id, { line: l, reason, detail }); };

function rule2Eligible(l: SnapLine): CloseReason | null {
  if (!fin(l.price_variance_pct) || !fin(l.price_per_base_unit) || l.price_per_base_unit <= 0 || !fin(l.expected_price_per_base_unit) || l.expected_price_per_base_unit <= 0) return "mangler_prisgrunnlag";
  if (Math.abs(l.price_variance_pct) > MAX_PRICE_PCT) return "prishopp_over_20";
  if (l.approved) return "godkjent_faktura";
  if (!["manual", "auto_high", "auto_medium"].includes(l.match_confidence ?? "")) return "ukjent_kobling";
  if (!readClean(l)) return "lesevarsel";
  return null;
}

function planLinked(c: Ctx, linked: SnapLine[]) {
  const r2 = new Map<string, SnapLine[]>();
  const r3 = new Map<string, { l: SnapLine; s: Valid | null; ppb: number | null; why: CloseReason | null }[]>();
  for (const l of linked) {
    const rs = reasonsOf(l);
    if (rs.length > 0 && rs.every((r) => PRICE_REASONS.includes(r))) {
      const why = rule2Eligible(l);
      if (why) close(c, l, why, why === "prishopp_over_20" && fin(l.price_variance_pct) ? `${l.price_variance_pct > 0 ? "+" : ""}${l.price_variance_pct.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %` : null);
      else r2.set(l.raw_material_id!, [...(r2.get(l.raw_material_id!) ?? []), l]);
      continue;
    }
    if (rs.length > 0 && rs.every((r) => PACKAGE_REASONS.includes(r))) {
      let why: CloseReason | null = null; let s: Valid | null = null; let ppb: number | null = null;
      if (isCreditLine(l)) why = "kreditlinje";
      else if (!readClean(l)) why = "lesevarsel";
      else {
        const d = readablePackage(l, l.rm_base_unit);
        const st = d ? readPackage(d, l.rm_base_unit) : null;
        if (!d) why = "pakning_uleselig";
        else if (!st || st.state !== "valid") why = "pakning_passer_ikke";
        else { s = st; ppb = linePricePerBase(l, st); if (ppb == null) why = "pakning_uleselig"; }
      }
      r3.set(l.raw_material_id!, [...(r3.get(l.raw_material_id!) ?? []), { l, s, ppb, why }]);
      continue;
    }
    close(c, l, otherReason(rs));
  }
  for (const [rm, ls] of r2) {
    const f = ls[0];
    c.items.push(base(2, "godta_pris", ls, {
      raw_material_id: rm, raw_material_name: f.rm_name,
      prices: ls.map((l) => ({ line_id: l.line_id, ppb: l.price_per_base_unit, date: l.invoice_date })),
      payload: { title: f.description ?? "", supplier_name: f.supplier_name, cost_before: f.rm_cost, lines: ls.map((l) => ({ id: l.line_id, price_per_base_unit: l.price_per_base_unit })) },
    }));
  }
  for (const [rm, evals] of r3) {
    const readable = evals.filter((e) => e.s != null);
    const consistent = readable.every((e) => samePackage(e.s!, readable[0].s!));
    const ok: typeof evals = [];
    for (const e of evals) {
      if (e.why) { close(c, e.l, e.why); continue; }
      if (!consistent) { close(c, e.l, "pakning_ulik"); continue; }
      if (!withinPackageGuard(e.ppb!, e.l.rm_cost)) {
        const pct = ((e.ppb! / e.l.rm_cost!) - 1) * 100;
        close(c, e.l, "pris_utenfor_20", `${fmtKr(e.ppb!)} kr/${e.l.rm_base_unit ?? "enhet"} mot kostpris ${fmtKr(e.l.rm_cost!)} (${pct > 0 ? "+" : ""}${pct.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %)`);
        continue;
      }
      ok.push(e);
    }
    if (ok.length === 0) continue;
    const f = ok[0];
    c.items.push(base(3, "bekreft_pakning", ok.map((e) => e.l), {
      raw_material_id: rm, raw_material_name: f.l.rm_name,
      prices: ok.map((e) => ({ line_id: e.l.line_id, ppb: e.ppb, date: e.l.invoice_date })),
      payload: { title: f.l.description ?? "", supplier_name: f.l.supplier_name, cost_before: f.l.rm_cost, package: packagePayload(f.s!) },
    }));
  }
}

function planUnlinkedItems(c: Ctx, g: SnapLine[], linked: SnapLine[], supplierRule: string | null) {
  const key = g[0].item_key ?? "";
  if (!key.startsWith("sku:")) { g.forEach((l) => close(c, l, "uten_varenummer")); return; }
  const eligible: { l: SnapLine; d: PackageDraft }[] = [];
  for (const l of g) {
    if (isCreditLine(l)) { close(c, l, "kreditlinje"); continue; }
    if (!readClean(l)) { close(c, l, "lesevarsel"); continue; }
    const d = readablePackage(l);
    if (!d) { close(c, l, "pakning_uleselig"); continue; }
    eligible.push({ l, d });
  }
  if (eligible.length === 0) return;
  const supplierId = g[0].supplier_id!;
  // Mål: varen de koblede linjene for samme leverandørvare alt står på, ellers samme varenummer hos leverandøren (inkl. lærte).
  const linkedRms = [...new Set(linked.map((l) => l.raw_material_id!))];
  const links = c.cat.links.filter((x) => x.supplier_id === supplierId);
  let target: CatalogLink | null = null;
  if (linkedRms.length === 1) target = links.find((x) => x.raw_material_id === linkedRms[0]) ?? null;
  if (!target && linkedRms.length === 1) {
    const f = linked[0];
    target = { supplier_id: supplierId, raw_material_id: f.raw_material_id!, name: f.rm_name ?? "", base_unit: f.rm_base_unit, is_active: f.rm_active, cost: f.rm_cost, skus: [] };
  }
  if (!target) {
    const sku = key.slice(4);
    const hits = links.filter((x) => x.skus.includes(sku));
    const active = [...new Map(hits.filter((x) => x.is_active).map((x) => [x.raw_material_id, x])).values()];
    if (active.length > 1) { eligible.forEach((e) => close(c, e.l, "flere_varer", active.map((a) => `«${a.name}»`).join(", "))); return; }
    if (active.length === 0 && hits.length > 0) { eligible.forEach((e) => close(c, e.l, "inaktiv_vare", `«${hits[0].name}»`)); return; }
    target = active[0] ?? null;
  }
  // Grunnlag: linjen med renest lesing – lest pakning foran fakturert i grunnenhet, så nyeste faktura.
  const basis = [...eligible].sort((a, b) => Number(b.d.source === "lest") - Number(a.d.source === "lest") || (b.l.invoice_date ?? "").localeCompare(a.l.invoice_date ?? "") || a.l.line_id.localeCompare(b.l.line_id))[0];
  const baseUnit = target ? target.base_unit : baseUnitForNew(basis.d.unit);
  const bs = readPackage(basis.d, baseUnit);
  if (bs.state !== "valid") { eligible.forEach((e) => close(c, e.l, "pakning_passer_ikke")); return; }
  const members: { l: SnapLine; s: Valid }[] = [];
  for (const e of eligible) {
    const s = readPackage(e.d, baseUnit);
    if (s.state === "valid" && samePackage(s, bs)) members.push({ l: e.l, s }); else close(c, e.l, "pakning_ulik");
  }
  const prices = members.map((m) => ({ line_id: m.l.line_id, ppb: linePricePerBase(m.l, m.s), date: m.l.invoice_date }));
  const pkg = packagePayload(bs);
  if (target) {
    c.items.push(base(4, "koble", members.map((m) => m.l), {
      raw_material_id: target.raw_material_id, raw_material_name: target.name, prices,
      payload: { title: basis.l.description ?? "", supplier_name: basis.l.supplier_name, cost_before: target.cost, package: pkg },
    }));
    return;
  }
  const name = cleanItemName(basis.l.description);
  const type = guessItemType(basis.l.description, isNewItemType(supplierRule) ? supplierRule : null);
  // Duplikatvakt: en annen aktiv vare hos samme leverandør med svært likt navn (samme terskel som gjør at Nye varer foreslår «Koble»).
  const dup = links.find((x) => x.is_active && Math.max(nameSimilarity(name, x.name), nameSimilarity(basis.l.description, x.name)) >= SUGGEST_MIN);
  const sameRun = (c.planned.get(supplierId) ?? []).find((n) => nameSimilarity(name, n) >= SUGGEST_MIN);
  if (dup || sameRun) {
    members.forEach((m) => close(c, m.l, "mulig_duplikat", dup ? `ligner «${dup.name}»` : `ligner «${sameRun}» som opprettes i samme kjøring`));
    return;
  }
  c.planned.set(supplierId, [...(c.planned.get(supplierId) ?? []), name]);
  c.items.push(base(4, "opprett", members.map((m) => m.l), {
    raw_material_name: name, prices,
    payload: { title: basis.l.description ?? "", supplier_name: basis.l.supplier_name, cost_before: null, package: pkg,
      new_raw_material: { name, base_unit: bs.baseUnit, item_type: type, category: NEW_ITEM_CATEGORY } },
  }));
}

/** Regel 1–6 på et utvalg åpne linjer. Fase 1 kjører regel 1–4; `closes` er regel 6 (alt annet). */
export function classify(lines: readonly SnapLine[], cat: Catalog): { items: PlanItem[]; closes: PlanItem[]; leftOpen: LeftOpen[] } {
  const c: Ctx = { cat, items: [], closes: new Map(), planned: new Map() };
  const rules = new Map(cat.suppliers.map((s) => [s.id, s.new_item_type]));
  const groups = new Map<string, SnapLine[]>();
  for (const l of [...lines].sort(byOldest)) {
    // Regel 5: sumavvik på fakturaen – linjene røres ikke av regel 1–4.
    if (l.lines_sum_status === "mismatch") { close(c, l, "sumavvik"); continue; }
    if (!l.supplier_id || !l.item_key) { close(c, l, "mangler_leverandor"); continue; }
    const k = `${l.supplier_id}|${l.item_key}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const g of groups.values()) {
    const linked = g.filter((l) => l.raw_material_id != null);
    const unlinked = g.filter((l) => l.raw_material_id == null);
    const notItem = unlinked.filter((l) => NOT_ITEM_KINDS.includes(l.line_kind ?? ""));
    const goods = unlinked.filter((l) => (l.line_kind ?? "vare") === "vare");
    unlinked.filter((l) => !notItem.includes(l) && !goods.includes(l)).forEach((l) => close(c, l, "annen_linjetype"));
    if (notItem.length > 0) {
      // «Ikke vare» lager en regel for varenøkkelen; den brukes bare når nøkkelen ikke også gjelder varer.
      if (goods.length === 0 && linked.length === 0) c.items.push(base(1, "ikke_vare", notItem));
      else notItem.forEach((l) => close(c, l, "blandet_varenokkel"));
    }
    planLinked(c, linked);
    if (goods.length > 0) planUnlinkedItems(c, goods, linked, rules.get(g[0].supplier_id!) ?? null);
  }
  const sorted = [...c.closes.values()].sort((a, b) => byOldest(a.line, b.line));
  const leftOpen: LeftOpen[] = sorted.filter((x) => x.line.exclusion_blocker).map(({ line, reason }) => ({
    line_id: line.line_id, invoice_id: line.invoice_id, invoice_number: line.invoice_number, description: line.description, supplier_name: line.supplier_name,
    blocker: line.exclusion_blocker!, reason_code: reason }));
  const closes = sorted.filter((x) => !x.line.exclusion_blocker).map(({ line, reason, detail }) =>
    base(6, "hold_utenfor", [line], {
      reason_code: reason, detail, raw_material_id: line.raw_material_id, raw_material_name: line.rm_name,
      payload: { title: line.description ?? "", supplier_name: line.supplier_name, invoice_id: line.invoice_id, line_updated_at: line.line_updated_at,
        reason_text: `${CLOSE_TEXT} – regel 6: ${CLOSE_REASON_LABEL[reason]}`, detail },
    }));
  const order: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3 };
  const firstDate = (i: PlanItem) => i.prices[0]?.date ?? "";
  c.items.sort((a, b) => order[a.rule] - order[b.rule] || firstDate(a).localeCompare(firstDate(b)) || (a.item_key ?? "").localeCompare(b.item_key ?? ""));
  return { items: c.items, closes, leftOpen };
}

function totals(items: readonly PlanItem[]): Record<Rule, RuleTotals> {
  const out = {} as Record<Rule, RuleTotals>;
  for (const r of RULES) {
    const its = items.filter((i) => i.rule === r);
    out[r] = {
      lines: its.reduce((s, i) => s + i.line_ids.length, 0),
      supplierItems: new Set(its.filter((i) => i.item_key).map((i) => `${i.supplier_id}|${i.item_key}`)).size,
      rawMaterials: new Set(its.filter((i) => i.raw_material_id).map((i) => i.raw_material_id)).size + its.filter((i) => i.action === "opprett").length,
      newItems: its.filter((i) => i.action === "opprett").length,
    };
  }
  return out;
}

function supplierTotals(items: readonly PlanItem[]): SupplierTotals[] {
  const m = new Map<string, SupplierTotals>();
  for (const i of items) {
    const k = i.supplier_id ?? "–";
    const t = m.get(k) ?? { supplier_id: i.supplier_id, name: i.supplier_name ?? "Ukjent leverandør", byRule: { 1: 0, 2: 0, 3: 0, 4: 0, 6: 0 }, lines: 0 };
    t.byRule[i.rule] += i.line_ids.length; t.lines += i.line_ids.length;
    m.set(k, t);
  }
  return [...m.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name, "nb"));
}

/** Anslått ny kostpris: prisen fra nyeste faktura i nullstillingen for varen (endelig pris velges av dagens prisvelger). */
export function costChanges(items: readonly PlanItem[]): CostChange[] {
  const best = new Map<string, CostChange>();
  for (const i of items) {
    if (!i.raw_material_id || !["godta_pris", "bekreft_pakning", "koble"].includes(i.action)) continue;
    for (const p of i.prices) {
      if (p.ppb == null) continue;
      const cur = best.get(i.raw_material_id);
      if (cur && (cur.date ?? "") > (p.date ?? "")) continue;
      const before = i.payload.cost_before ?? null;
      best.set(i.raw_material_id, { raw_material_id: i.raw_material_id, name: i.raw_material_name ?? "", base_unit: null, before, after: p.ppb,
        pct: before != null && before > 0 ? (p.ppb / before - 1) * 100 : null, rule: i.rule, date: p.date });
    }
  }
  return [...best.values()].filter((c) => c.before == null || Math.abs(c.after - c.before) > 0.005).sort((a, b) => Math.abs(b.pct ?? 1e9) - Math.abs(a.pct ?? 1e9) || a.name.localeCompare(b.name, "nb"));
}

export function creations(items: readonly PlanItem[]): Creation[] {
  return items.filter((i) => i.action === "opprett" && i.payload.new_raw_material).map((i) => {
    const n = i.payload.new_raw_material!;
    const newest = [...i.prices].filter((p) => p.ppb != null).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
    return { supplier_name: i.supplier_name, name: n.name, item_type: n.item_type, base_unit: n.base_unit, package: i.payload.package ?? null, lines: i.line_ids.length, price: newest?.ppb ?? null, item_key: i.item_key ?? "" };
  });
}

/** Forhåndsvisningen (fase 1). */
export function planPhase1(lines: readonly SnapLine[], cat: Catalog): Plan {
  const { items, closes, leftOpen } = classify(lines, cat);
  const all = [...items, ...closes];
  const snapshotIds = lines.map((l) => l.line_id).sort();
  const fp = hash(`${[...lines].sort((a, b) => a.line_id.localeCompare(b.line_id)).map((l) => `${l.line_id}@${l.line_updated_at}`).join(",")}|${items.map((i) => `${i.rule}:${i.action}:${i.line_ids.join("+")}`).join(";")}`);
  return { snapshotIds, items, closes, totals: totals(all), bySupplier: supplierTotals(all), costChanges: costChanges(items), creations: creations(items), leftOpen, fingerprint: `nq1-${snapshotIds.length}-${fp}` };
}

/**
 * Fase 2 (etter regel 1–4 og når omregningskøen er tom): linjene i utvalget som fortsatt er åpne. Regel 2 gjelder på nytt
 * (linjer som fikk prisavvik ≤ 20 % etter kobling); alt annet avsluttes med regel 6. Regel 6 kjøres først.
 */
export function planPhase2(lines: readonly SnapLine[], snapshot: ReadonlySet<string>, cat: Catalog): PlanItem[] {
  const open = lines.filter((l) => snapshot.has(l.line_id));
  const { items, closes } = classify(open, cat);
  const keep = items.filter((i) => i.rule === 2);
  const byId = new Map(open.map((l) => [l.line_id, l]));
  const reopened = items.filter((i) => i.rule !== 2).flatMap((i) => i.line_ids).map((id) => byId.get(id)).filter((l): l is SnapLine => !!l && !l.exclusion_blocker);
  const more = reopened.sort(byOldest).map((line) => base(6, "hold_utenfor", [line], {
    reason_code: "apen_etter_fase_1", raw_material_id: line.raw_material_id, raw_material_name: line.rm_name,
    payload: { title: line.description ?? "", supplier_name: line.supplier_name, invoice_id: line.invoice_id, line_updated_at: line.line_updated_at,
      reason_text: `${CLOSE_TEXT} – regel 6: ${CLOSE_REASON_LABEL.apen_etter_fase_1}` },
  }));
  return [...closes, ...more, ...keep];
}
