// 5. Fasitsett og måling. Ren kode (vitest + innstillingssiden).
//
// En fasitfaktura har linjer som Henrik har kontrollert; linjene fryses ved merkingen (invoice_gold_invoices).
// Måleverktøyet leser fasitfakturaene med gjeldende oppsett og med et kandidatoppsett (invoice-model-eval) og
// sammenligner hver lesing felt for felt med fasiten. Fasit sendes aldri til modellen.
//
// Kobling av leste linjer til fasitlinjer: eksakt varenummer (entydig), så entydig likt beløp, så entydig likt
// varenavn. Et felt som ble brukt til koblingen, scores ikke (beløp ved beløpskobling).

export const GOLD_FIELDS = ["varenummer", "antall", "enhet", "pris", "sum", "pakning"] as const;
export type GoldField = (typeof GOLD_FIELDS)[number];
export const GOLD_FIELD_LABEL: Record<GoldField, string> = { varenummer: "Varenummer", antall: "Antall", enhet: "Enhet", pris: "Pris", sum: "Sum", pakning: "Pakning" };

export interface GoldLine {
  sku: string | null; description: string | null; line_kind: string | null;
  quantity: number | null; unit: string | null; unit_price: number | null; total_amount: number | null;
  package_size: number | null; package_unit: string | null; count_per_package: number | null;
}

export type FieldCounts = Record<GoldField, { n: number; ok: number }>;
export interface GoldScore { fields: FieldCounts; expected: number; read: number; matched: number; missing: number; extra: number; errors: string[] }

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Leser linjer fra fasitens frosne kopi eller fra en lesing (supplier_sku eller sku). */
export function toGoldLines(v: unknown): GoldLine[] {
  if (!Array.isArray(v)) return [];
  return v.map(rec).map((r) => ({
    sku: txt(r.sku) ?? txt(r.supplier_sku), description: txt(r.description), line_kind: txt(r.line_kind),
    quantity: num(r.quantity), unit: txt(r.unit), unit_price: num(r.unit_price), total_amount: num(r.total_amount),
    package_size: num(r.package_size), package_unit: txt(r.package_unit), count_per_package: num(r.count_per_package),
  }));
}

const skuKey = (s: string | null) => (s ? s.toLowerCase().replace(/[^a-z0-9]/g, "") || null : null);
const descKey = (s: string | null) => (s ? s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9æøå]+/g, " ").trim() || null : null);
const unitKey = (s: string | null) => {
  const u = (s ?? "").toLowerCase().replace(/\.$/, "").trim();
  const a: Record<string, string> = { st: "stk", pcs: "stk", ea: "stk", gr: "g", gram: "g", kilo: "kg", ltr: "l", liter: "l" };
  return u ? a[u] ?? u : null;
};
const same = (a: number | null, b: number | null, tol = 0.005) => a != null && b != null && Math.abs(a - b) <= tol;
const pkgKey = (l: GoldLine) => (l.package_size == null ? null : `${l.count_per_package ?? 1}x${l.package_size}${unitKey(l.package_unit) ?? ""}`);

export function emptyCounts(): FieldCounts {
  return { varenummer: { n: 0, ok: 0 }, antall: { n: 0, ok: 0 }, enhet: { n: 0, ok: 0 }, pris: { n: 0, ok: 0 }, sum: { n: 0, ok: 0 }, pakning: { n: 0, ok: 0 } };
}

export function matchGold(read: readonly GoldLine[], gold: readonly GoldLine[]): Array<{ g: number; r: number; by: "sku" | "sum" | "tekst" }> {
  const used = new Set<number>(), pairs: Array<{ g: number; r: number; by: "sku" | "sum" | "tekst" }> = [];
  const done = (g: number) => pairs.some((p) => p.g === g);
  const pass = (by: "sku" | "sum" | "tekst", key: (l: GoldLine) => string | number | null, eq: (a: string | number, b: string | number) => boolean) => {
    gold.forEach((gl, gi) => {
      if (done(gi)) return;
      const k = key(gl);
      if (k == null) return;
      if (gold.filter((x, xi) => !done(xi) && key(x) != null && eq(key(x) as string | number, k)).length !== 1) return;
      const hits = read.flatMap((l, j) => { const rk = key(l); return !used.has(j) && rk != null && eq(rk, k) ? [j] : []; });
      if (hits.length === 1) { used.add(hits[0]); pairs.push({ g: gi, r: hits[0], by }); }
    });
  };
  pass("sku", (l) => skuKey(l.sku), (a, b) => a === b);
  pass("sum", (l) => l.total_amount, (a, b) => same(a as number, b as number));
  pass("tekst", (l) => descKey(l.description), (a, b) => a === b);
  return pairs;
}

export function scoreGold(read: readonly GoldLine[], gold: readonly GoldLine[]): GoldScore {
  const pairs = matchGold(read, gold);
  const f = emptyCounts();
  const errors: string[] = [];
  for (const p of pairs) {
    const g = gold[p.g], r = read[p.r];
    const label = g.sku ? `varenr ${g.sku}` : `«${(g.description ?? "").slice(0, 40)}»`;
    const score = (field: GoldField, ok: boolean, detail: string) => { f[field].n++; if (ok) f[field].ok++; else errors.push(`${label} ${GOLD_FIELD_LABEL[field].toLowerCase()}: ${detail}`); };
    if (g.sku && p.by !== "sku") score("varenummer", skuKey(r.sku) === skuKey(g.sku), `lest ${r.sku ?? "mangler"}, fasit ${g.sku}`);
    else if (g.sku) score("varenummer", true, "");
    if (g.quantity != null) score("antall", same(r.quantity, g.quantity, 0.0005), `lest ${r.quantity ?? "mangler"}, fasit ${g.quantity}`);
    if (g.unit) score("enhet", unitKey(r.unit) === unitKey(g.unit), `lest ${r.unit ?? "mangler"}, fasit ${g.unit}`);
    if (g.unit_price != null) score("pris", same(r.unit_price, g.unit_price), `lest ${r.unit_price ?? "mangler"}, fasit ${g.unit_price}`);
    if (g.total_amount != null && p.by !== "sum") score("sum", same(r.total_amount, g.total_amount), `lest ${r.total_amount ?? "mangler"}, fasit ${g.total_amount}`);
    if (pkgKey(g)) score("pakning", pkgKey(r) === pkgKey(g), `lest ${pkgKey(r) ?? "mangler"}, fasit ${pkgKey(g)}`);
  }
  const missing = gold.length - pairs.length;
  if (missing > 0) errors.push(`${missing} fasitlinje(r) ble ikke funnet i lesingen`);
  const extra = read.length - pairs.length;
  if (extra > 0) errors.push(`${extra} lest(e) linje(r) finnes ikke i fasiten`);
  return { fields: f, expected: gold.length, read: read.length, matched: pairs.length, missing, extra, errors };
}

/** Ikke-koblede fasitlinjer teller som feil i alle felt fasiten har verdi for (mangler = feil, aldri ukjent). */
export function withMissingAsErrors(s: GoldScore, gold: readonly GoldLine[], read: readonly GoldLine[]): FieldCounts {
  const f: FieldCounts = JSON.parse(JSON.stringify(s.fields));
  const matched = new Set(matchGold(read, gold).map((p) => p.g));
  gold.forEach((g, i) => {
    if (matched.has(i)) return;
    if (g.sku) f.varenummer.n++;
    if (g.quantity != null) f.antall.n++;
    if (g.unit) f.enhet.n++;
    if (g.unit_price != null) f.pris.n++;
    if (g.total_amount != null) f.sum.n++;
    if (pkgKey(g)) f.pakning.n++;
  });
  return f;
}

export function addCounts(a: FieldCounts, b: FieldCounts): FieldCounts {
  const o = emptyCounts();
  for (const k of GOLD_FIELDS) o[k] = { n: a[k].n + b[k].n, ok: a[k].ok + b[k].ok };
  return o;
}

export const rate = (c: { n: number; ok: number }): number | null => (c.n > 0 ? c.ok / c.n : null);

export interface SetupResult { supplier: string; invoiceId: string; counts: FieldCounts | null; status: "ok" | "feil" }

/** Treff per leverandør og felt, og totalt. En feilet lesing teller alle fasitfelt som feil. */
export function aggregate(results: readonly SetupResult[]): { total: FieldCounts; bySupplier: Map<string, FieldCounts>; failed: number } {
  let total = emptyCounts();
  const bySupplier = new Map<string, FieldCounts>();
  let failed = 0;
  for (const r of results) {
    if (!r.counts) { failed++; continue; }
    total = addCounts(total, r.counts);
    bySupplier.set(r.supplier, addCounts(bySupplier.get(r.supplier) ?? emptyCounts(), r.counts));
  }
  return { total, bySupplier, failed };
}

export interface Verdict { notWorse: boolean; worseFields: GoldField[]; worseSuppliers: Array<{ supplier: string; field: GoldField }>; reason: string }

/**
 * Kandidaten er «ikke dårligere» bare når: samme fasitsett ble lest uten flere feilede lesinger, og treffraten
 * totalt er minst like høy i ALLE felt. Fall per leverandør vises som varsel. Uten fasitfelt: aldri godkjent.
 */
export function verdict(current: ReturnType<typeof aggregate>, candidate: ReturnType<typeof aggregate>): Verdict {
  const worseFields = GOLD_FIELDS.filter((k) => { const a = rate(current.total[k]), b = rate(candidate.total[k]); return a != null && (b == null || b + 1e-9 < a); });
  const worseSuppliers: Verdict["worseSuppliers"] = [];
  for (const [sup, c] of current.bySupplier) {
    const k2 = candidate.bySupplier.get(sup);
    for (const k of GOLD_FIELDS) { const a = rate(c[k]), b = k2 ? rate(k2[k]) : null; if (a != null && (b == null || b + 1e-9 < a)) worseSuppliers.push({ supplier: sup, field: k }); }
  }
  const anyField = GOLD_FIELDS.some((k) => current.total[k].n > 0);
  if (!anyField) return { notWorse: false, worseFields, worseSuppliers, reason: "Ingen fasitfelt ble målt." };
  if (candidate.failed > current.failed) return { notWorse: false, worseFields, worseSuppliers, reason: `Kandidaten feilet på ${candidate.failed - current.failed} flere fakturaer.` };
  if (worseFields.length) return { notWorse: false, worseFields, worseSuppliers, reason: `Kandidaten er dårligere på ${worseFields.map((k) => GOLD_FIELD_LABEL[k].toLowerCase()).join(", ")}.` };
  return { notWorse: true, worseFields, worseSuppliers, reason: worseSuppliers.length ? "Ikke dårligere totalt, men svakere for enkelte leverandører (se under)." : "Ikke dårligere i noe felt." };
}
