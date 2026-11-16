// Prisgrunnlag (variant B fase 5): hvilke innsatsfaktorer har drevet kostendringen, og hva betyr det
// for Brutto og DG2. Ren logikk (testes). Historiske priser sammenlignes bare når den låste
// enheten i prishistorikken (snapshot_unit) er lik råvarens grunnenhet i dag. Udokumentert enhet er
// ukjent og telles for seg, aldri tolket med dagens enhet.

export type Period = 3 | 6 | 12 | "alt";
export const PERIODS: readonly Period[] = [3, 6, 12, "alt"];
export const DEFAULT_PERIOD: Period = 12;
export const PERIOD_LABEL: Record<string, string> = { "3": "3 mnd", "6": "6 mnd", "12": "12 mnd", alt: "Så langt data finnes" };
/** Endringer mindre enn dette regnes som uendret. */
export const MIN_CHANGE_PCT = 0.5;

export function parsePeriod(v: string | null): Period {
  if (v === "3") return 3;
  if (v === "6") return 6;
  if (v === "alt") return "alt";
  return DEFAULT_PERIOD;
}

/** Startdato (YYYY-MM-DD) for perioden; null = så langt data finnes. Månedsslutt klemmes (31.05 − 3 mnd = 28/29.02). */
export function periodStart(todayIso: string, p: Period): string | null {
  if (p === "alt") return null;
  const [y, m, d] = todayIso.split("-").map(Number);
  let mm = m - p;
  let yy = y;
  while (mm < 1) { mm += 12; yy -= 1; }
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const dd = Math.min(d, last);
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export interface FactorMaterial { id: string; name: string; baseUnit: string | null; usableCost: number | null }
export interface HistoryRow { rawMaterialId: string; price: number; date: string; unit: string | null; currency: string | null }
export interface FactorChange {
  rawMaterialId: string; name: string; baseUnit: string;
  thenPrice: number; thenDate: string; nowPrice: number; changePct: number;
  /** Ingen pris før perioden: sammenlignet med første pris i perioden. */
  firstInPeriod: boolean;
}

const norm = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

export function isComparable(row: HistoryRow, baseUnit: string | null): boolean {
  if (!baseUnit || !row.unit) return false;
  if (norm(row.unit) !== norm(baseUnit)) return false;
  if (row.currency && row.currency.toUpperCase() !== "NOK") return false;
  return Number.isFinite(row.price) && row.price > 0;
}

/** Innsatsfaktorer med prisendring i perioden, størst endring først, og antall med ukjent grunnlag. */
export function factorChanges(materials: readonly FactorMaterial[], history: readonly HistoryRow[], start: string | null): { changes: FactorChange[]; unknown: number } {
  const byRm = new Map<string, HistoryRow[]>();
  for (const h of history) {
    const arr = byRm.get(h.rawMaterialId) ?? [];
    arr.push(h);
    byRm.set(h.rawMaterialId, arr);
  }
  const changes: FactorChange[] = [];
  let unknown = 0;
  for (const m of materials) {
    const rows = (byRm.get(m.id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) continue;
    const inPeriod = rows.filter((r) => start == null || r.date >= start);
    if (m.usableCost == null || !m.baseUnit) { if (inPeriod.length) unknown++; continue; }
    const comp = rows.filter((r) => isComparable(r, m.baseUnit));
    let base: HistoryRow | undefined;
    let first = false;
    if (start == null) base = comp[0];
    else {
      base = [...comp].reverse().find((r) => r.date < start);
      if (!base) { base = comp.find((r) => r.date >= start); first = !!base; }
    }
    if (!base) { if (inPeriod.length) unknown++; continue; }
    const pct = (m.usableCost / base.price - 1) * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) < MIN_CHANGE_PCT) continue;
    changes.push({
      rawMaterialId: m.id, name: m.name, baseUnit: m.baseUnit, thenPrice: base.price, thenDate: base.date,
      nowPrice: m.usableCost, changePct: Math.round(pct * 10) / 10, firstInPeriod: first,
    });
  }
  changes.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.name.localeCompare(b.name, "nb"));
  return { changes, unknown };
}

export interface CostParts { raw: number; labor: number; energy: number; pack: number }
export interface MarginFigures { varekost: number; selvkost: number; bruttoPct: number | null; db2: number | null; dg2Pct: number | null }

/** Brutto = (pris − varekost) / pris. DG2 = (pris − varekost − arbeid − energi) / pris. Varekost tar med emballasje når innstillingen er på. */
export function marginFigures(price: number | null, c: CostParts, packInMargins: boolean): MarginFigures {
  const varekost = c.raw + (packInMargins ? c.pack : 0);
  const selvkost = c.raw + c.pack + c.labor + c.energy;
  if (price == null || !Number.isFinite(price) || price <= 0) return { varekost, selvkost, bruttoPct: null, db2: null, dg2Pct: null };
  const db2 = price - varekost - c.labor - c.energy;
  return { varekost, selvkost, bruttoPct: ((price - varekost) / price) * 100, db2, dg2Pct: (db2 / price) * 100 };
}

/** Pris som holder både Brutto- og DG2-målet (samme regel som databasen). */
export function neededPrice(c: CostParts, packInMargins: boolean, targetBrutto: number | null, targetDg2: number | null): number | null {
  const v = c.raw + (packInMargins ? c.pack : 0);
  const a = targetBrutto != null && targetBrutto < 100 ? v / (1 - targetBrutto / 100) : 0;
  const b = targetDg2 != null && targetDg2 < 100 ? (v + c.labor + c.energy) / (1 - targetDg2 / 100) : 0;
  const n = Math.max(a, b);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

export interface UsageLine { rawMaterialId: string; quantity: number | null; unit: string | null; quantityGrams: number | null; wastePct: number | null }

/** Mengde i råvarens grunnenhet. Null = ukjent (f.eks. stk uten vekt), aldri gjettet. */
export function qtyInBaseUnit(l: UsageLine, baseUnit: string | null): number | null {
  const b = norm(baseUnit);
  if (b === "kg" && l.quantityGrams != null) return l.quantityGrams / 1000;
  if (b === "g" && l.quantityGrams != null) return l.quantityGrams;
  if (l.quantity != null && norm(l.unit) === b && b) return l.quantity;
  if (b === "kg" && norm(l.unit) === "g" && l.quantity != null) return l.quantity / 1000;
  return null;
}

export interface Driver { rawMaterialId: string; name: string; deltaPerUnit: number }

/** Anslått kostendring per enhet fra hver endret innsatsfaktor i én oppskrift. Halvfabrikat brytes ikke ned. */
export function productDrivers(lines: readonly UsageLine[], changes: ReadonlyMap<string, FactorChange>, unitsPerBatch: number | null): { drivers: Driver[]; unknownLines: number } {
  const drivers = new Map<string, Driver>();
  let unknownLines = 0;
  if (!unitsPerBatch || unitsPerBatch <= 0) return { drivers: [], unknownLines: lines.filter((l) => changes.has(l.rawMaterialId)).length };
  for (const l of lines) {
    const ch = changes.get(l.rawMaterialId);
    if (!ch) continue;
    const q = qtyInBaseUnit(l, ch.baseUnit);
    if (q == null) { unknownLines++; continue; }
    const delta = (q * (1 + (l.wastePct ?? 0) / 100) * (ch.nowPrice - ch.thenPrice)) / unitsPerBatch;
    const d = drivers.get(ch.rawMaterialId) ?? { rawMaterialId: ch.rawMaterialId, name: ch.name, deltaPerUnit: 0 };
    d.deltaPerUnit += delta;
    drivers.set(ch.rawMaterialId, d);
  }
  return { drivers: [...drivers.values()].sort((a, b) => Math.abs(b.deltaPerUnit) - Math.abs(a.deltaPerUnit)), unknownLines };
}

const kr = (n: number) => `${n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
const pct = (n: number | null) => (n == null ? "ukjent" : `${n.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);

/** Tekst som følger prisrunden. */
export function documentationText(i: {
  productName: string; listName: string; periodLabel: string;
  drivers: readonly Driver[]; changes: ReadonlyMap<string, FactorChange>;
  priceNow: number | null; newPrice: number | null;
  now: MarginFigures; next: MarginFigures | null;
}): string {
  const parts: string[] = [];
  const top = i.drivers.slice(0, 3).map((d) => {
    const c = i.changes.get(d.rawMaterialId);
    return c ? `${d.name} ${c.changePct > 0 ? "+" : ""}${pct(c.changePct)} (${kr(c.thenPrice)} → ${kr(c.nowPrice)} per ${c.baseUnit})` : d.name;
  });
  parts.push(`${i.productName} (${i.listName}).`);
  if (top.length) parts.push(`Innpris siste ${i.periodLabel}: ${top.join(", ")}.`);
  const sum = i.drivers.reduce((s, d) => s + d.deltaPerUnit, 0);
  if (i.drivers.length) parts.push(`Det gir ${sum >= 0 ? "økt" : "redusert"} varekost på om lag ${kr(Math.abs(sum))} per enhet.`);
  parts.push(`Ved dagens pris ${i.priceNow != null ? kr(i.priceNow) : "(ingen pris)"}: Brutto ${pct(i.now.bruttoPct)}, DG2 ${pct(i.now.dg2Pct)}.`);
  if (i.newPrice != null && i.next) {
    const ch = i.priceNow ? ` (${i.newPrice >= i.priceNow ? "+" : ""}${pct((i.newPrice / i.priceNow - 1) * 100)})` : "";
    parts.push(`Ny pris ${kr(i.newPrice)}${ch}: Brutto ${pct(i.next.bruttoPct)}, DG2 ${pct(i.next.dg2Pct)}.`);
  }
  return parts.join(" ");
}
