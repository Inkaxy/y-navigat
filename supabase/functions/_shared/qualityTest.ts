// Ren poengberegning for kvalitetstesten av fakturalesing (vitest + Deno).
// Brukes BARE etter modellsvaret; fasit sendes aldri til modellen.
//
// Mål per faktura:
//  - sum: linjesum mot kontrollsummen fra Tripletex (eks. mva, kreditnota-justert, ±2 %). Mangler mva,
//    er treffet ukjent — mva gjettes aldri.
//  - arithmetic: linjer der antall × pris (med lest prisgrunnlag og rabatt) = beløp, samme regel som lesekontrollen.
//  - fees: pant/frakt/gebyr/rabatt som egne linjer.
//  - pages: hvilke sider linjene kom fra.
//  - fasit: linjer kobles på eksakt varenummer, ellers på entydig likt beløp (da scores ikke beløpet).

import type { ExtractedLine } from "./invoiceExtraction.ts";
import { checkSum } from "./invoiceExtraction.ts";
import { lineReadIssues } from "./invoiceReadCheck.ts";
import { expectedExclVat, LINES_SUM_TOLERANCE_PCT } from "./lines-sum.ts";
import { normSku, type Fasit } from "./evalFasit.ts";
import { QUALITY_TEST_VERSION, type QualityRole } from "./qualityTestSet.ts";

export interface FasitRow { sku: string | null; description: string | null; line_kind: string | null; quantity: number | null; unit_price: number | null; total_amount: number | null }

export type QualityLine = Pick<ExtractedLine, "sku" | "description" | "line_kind" | "quantity" | "unit" | "unit_price" | "total_amount" | "package_size" | "package_unit" | "count_per_package" | "price_basis" | "discount_amount" | "page_number">;

export interface FasitScoreV2 {
  source: "godkjent_lagret" | "dokumentkontrollert";
  expected: number;
  read: number;
  matched_by_sku: number;
  matched_by_amount: number;
  unmatched_expected: number;
  extra_read: number;
  sku_n: number; sku_ok: number;
  qty_n: number; qty_ok: number;
  price_n: number; price_ok: number;
  /** Bare linjer koblet på varenummer: et beløp brukt til kobling kan ikke også scores. */
  amount_n: number; amount_ok: number;
  fee_expected: number; fee_found: number;
  errors: string[];
}

export interface QualityMetrics {
  version: string;
  role: QualityRole;
  line_count: number;
  sum: { lines_sum: number; expected_excl: number | null; deviation_pct: number | null; missing: number | null; hit: boolean | null; unknown_reason: "mva_mangler" | "total_mangler" | "ingen_linjer" | null; total_incl: number | null };
  arithmetic: { with_numbers: number; ok: number; missing_numbers: number; failing: string[] };
  fees: { pant: number; frakt: number; gebyr: number; rabatt: number };
  pages: { total: number | null; with_lines: number[]; unknown_page_lines: number; last_page_has_lines: boolean | null };
  fasit: FasitScoreV2 | null;
}

const FEE_KINDS = new Set(["pant", "frakt", "gebyr"]);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const same = (a: unknown, b: number | null, tol = 0.005) => fin(a) && fin(b) && Math.abs(a - b) <= tol;
const kindOf = (k: string | null | undefined) => (k ?? "").trim().toLowerCase() || "vare";
const nb = (n: number | null | undefined) => (fin(n) ? new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 3 }).format(n) : "mangler");

/** Dokumentkontrollert fasit (evalFasit.ts) som rader. */
export function fasitRowsFromVerified(f: Fasit): FasitRow[] {
  return f.lines.map((l) => ({ sku: l.sku, description: null, line_kind: "vare", quantity: l.quantity, unit_price: l.unit_price, total_amount: l.total_amount }));
}

/** Kobler fasit til leste linjer: først eksakt varenummer (entydig begge veier), deretter entydig likt beløp. */
export function matchFasit(read: readonly QualityLine[], fasit: readonly FasitRow[]): Array<{ f: number; r: number; by: "sku" | "belop" }> {
  const used = new Set<number>();
  const pairs: Array<{ f: number; r: number; by: "sku" | "belop" }> = [];
  fasit.forEach((fl, i) => {
    const s = normSku(fl.sku);
    if (!s || fasit.filter((x) => normSku(x.sku) === s).length !== 1) return;
    const hits = read.flatMap((l, j) => (!used.has(j) && normSku(l.sku) === s ? [j] : []));
    if (hits.length === 1) { used.add(hits[0]); pairs.push({ f: i, r: hits[0], by: "sku" }); }
  });
  fasit.forEach((fl, i) => {
    if (pairs.some((p) => p.f === i) || !fin(fl.total_amount)) return;
    const twins = fasit.filter((x, k) => !pairs.some((p) => p.f === k) && same(x.total_amount, fl.total_amount)).length;
    const hits = read.flatMap((l, j) => (!used.has(j) && same(l.total_amount, fl.total_amount) ? [j] : []));
    if (twins === 1 && hits.length === 1) { used.add(hits[0]); pairs.push({ f: i, r: hits[0], by: "belop" }); }
  });
  return pairs;
}

export function scoreFasitV2(read: readonly QualityLine[], fasit: readonly FasitRow[], source: FasitScoreV2["source"]): FasitScoreV2 {
  const pairs = matchFasit(read, fasit);
  const errors: string[] = [];
  const s: FasitScoreV2 = {
    source, expected: fasit.length, read: read.length,
    matched_by_sku: pairs.filter((p) => p.by === "sku").length, matched_by_amount: pairs.filter((p) => p.by === "belop").length,
    unmatched_expected: fasit.length - pairs.length, extra_read: read.length - pairs.length,
    sku_n: 0, sku_ok: 0, qty_n: 0, qty_ok: 0, price_n: 0, price_ok: 0, amount_n: 0, amount_ok: 0,
    fee_expected: fasit.filter((f) => FEE_KINDS.has(kindOf(f.line_kind))).length, fee_found: 0, errors,
  };
  fasit.forEach((fl, i) => {
    const label = fl.sku ? `varenr. ${fl.sku}` : `fasitlinje ${i + 1}${fl.description ? ` (${fl.description.slice(0, 30)})` : ""}`;
    const p = pairs.find((x) => x.f === i);
    if (normSku(fl.sku)) s.sku_n++;
    if (!p) { errors.push(`${label}: ikke funnet blant leste linjer`); return; }
    const l = read[p.r];
    if (normSku(fl.sku)) {
      if (normSku(l.sku) === normSku(fl.sku)) s.sku_ok++; else errors.push(`${label}: lest varenr. ${l.sku ?? "mangler"}`);
    }
    if (FEE_KINDS.has(kindOf(fl.line_kind)) && FEE_KINDS.has(kindOf(l.line_kind))) s.fee_found++;
    s.qty_n++; if (same(l.quantity, fl.quantity, 0.0005)) s.qty_ok++; else errors.push(`${label}: antall lest ${nb(l.quantity)}, fasit ${nb(fl.quantity)}`);
    s.price_n++; if (same(l.unit_price, fl.unit_price)) s.price_ok++; else errors.push(`${label}: enhetspris lest ${nb(l.unit_price)}, fasit ${nb(fl.unit_price)}`);
    if (p.by === "sku") { s.amount_n++; if (same(l.total_amount, fl.total_amount)) s.amount_ok++; else errors.push(`${label}: beløp lest ${nb(l.total_amount)}, fasit ${nb(fl.total_amount)}`); }
  });
  if (read.length !== fasit.length) errors.push(`Antall linjer: lest ${read.length}, fasit ${fasit.length}`);
  return s;
}

export interface QualityInput {
  role: QualityRole;
  lines: readonly QualityLine[];
  totalAmount: number | null;
  totalVat: number | null;
  isCredit: boolean;
  totalPages: number | null;
  fasit: { rows: readonly FasitRow[]; source: FasitScoreV2["source"] } | null;
}

export function scoreQuality(i: QualityInput): QualityMetrics {
  const excl = expectedExclVat(i.totalAmount, i.totalVat, i.isCredit);
  const sc = checkSum(i.lines, excl, i.totalAmount, i.totalVat, i.isCredit);
  const unknown_reason = i.lines.length === 0 ? "ingen_linjer" : i.totalAmount == null ? "total_mangler" : i.totalVat == null ? "mva_mangler" : null;
  const hit = unknown_reason ? null : sc.deviation_pct != null && Math.abs(sc.deviation_pct) <= LINES_SUM_TOLERANCE_PCT;

  let withNumbers = 0, ok = 0, missing = 0;
  const failing: string[] = [];
  i.lines.forEach((l, idx) => {
    if (!fin(l.quantity) || !fin(l.unit_price) || !fin(l.total_amount)) { missing++; return; }
    withNumbers++;
    const issues = lineReadIssues({
      quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, total_amount: l.total_amount,
      package_size: l.package_size, package_unit: l.package_unit, count_per_package: l.count_per_package,
      unit_price_basis: l.price_basis ?? null, discount_amount: l.discount_amount, line_kind: l.line_kind, is_credit: i.isCredit,
    });
    if (issues.length === 0) ok++; else failing.push(`Linje ${idx + 1}: ${issues[0].message}`);
  });

  const fees = { pant: 0, frakt: 0, gebyr: 0, rabatt: 0 };
  for (const l of i.lines) { const k = kindOf(l.line_kind); if (k in fees) fees[k as keyof typeof fees]++; }

  const pagesSeen = [...new Set(i.lines.map((l) => l.page_number).filter((p): p is number => fin(p) && Number.isInteger(p)))].sort((a, b) => a - b);
  return {
    version: QUALITY_TEST_VERSION, role: i.role, line_count: i.lines.length,
    sum: { lines_sum: sc.lines_sum, expected_excl: sc.expected_excl_vat, deviation_pct: sc.deviation_pct, missing: sc.missing_amount, hit, unknown_reason, total_incl: i.totalAmount },
    arithmetic: { with_numbers: withNumbers, ok, missing_numbers: missing, failing: failing.slice(0, 20) },
    fees,
    pages: {
      total: i.totalPages, with_lines: pagesSeen,
      unknown_page_lines: i.lines.filter((l) => !fin(l.page_number)).length,
      last_page_has_lines: i.totalPages == null || pagesSeen.length === 0 ? null : pagesSeen.includes(i.totalPages),
    },
    fasit: i.fasit ? scoreFasitV2(i.lines, i.fasit.rows, i.fasit.source) : null,
  };
}
