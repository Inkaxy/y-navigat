// Tallkontroll etter lesing, uten AI. Ren modul (vitest + Deno).
//
// Problem: modellen kan lese «10.000» (10 kg) som 10 000 og «1.100,00» som 110 000. Da stemmer verken
// regnestykket på linjen eller fakturaens kontrollsum (PALS 526301).
//
// Regler:
//  - Bare tusenskille/desimaltegn tolkes på nytt: ×/÷ 1000 og ÷ 100 (komma tapt). Ingen andre faktorer.
//  - Et felt med trykt råtekst som har skilletegn («1 100,00») tolkes aldri på nytt: trykt form er fasit.
//  - Linjen rettes bare når NØYAKTIG ÉN tolkning (med færrest endrede felt) får regnestykket til å gå opp,
//    vurdert med samme regel som lesekontrollen (lineReadIssues).
//  - Rettelsene brukes bare når ALLE foreslåtte rettelser sammen gir en linjesum som stemmer med
//    kontrollsummen (±2 %). Ukjent kontrollsum = ingen retting. Beløp velges aldri for å treffe summen:
//    kontrollsummen er bare en sperre, tolkningen kommer fra linjens eget regnestykke.
//  - Ellers settes et lesevarsel som forteller hvilken tolkning som ville gått opp.

import { lineReadIssues, type ReadIssue } from "./invoiceReadCheck.ts";
import { creditAlignedExpected, LINES_SUM_TOLERANCE_PCT } from "./lines-sum.ts";
import type { NumberEvidence, NumberField } from "./numberTokens.ts";

export interface CheckLine {
  quantity: number | null; unit: string | null; unit_price: number | null; total_amount: number | null;
  package_size: number | null; package_unit: string | null; count_per_package: number | null;
  price_basis?: string | null; discount_amount: number | null; line_kind: string | null;
  read_issues: ReadIssue[]; number_evidence?: NumberEvidence[];
}

export interface NumberFix { field: NumberField; from: number; to: number }
export interface LineFixProposal { index: number; fixes: NumberFix[] }

const FIELDS: NumberField[] = ["quantity", "unit_price", "total_amount"];
const LABEL: Record<NumberField, string> = { quantity: "mengde", unit_price: "enhetspris", total_amount: "linjesum" };
/** Lesevarsler som tallkontrollen kan forklare (regnestykket går ikke opp). */
const ARITH_CODES = new Set(["regnestykke", "mulig_rabatt", "prisgrunnlag_uavklart"]);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Andre mulige verdier hvis tusenskille/desimaltegn er lest feil. Originalen er ikke med. */
export function separatorAlternatives(v: number | null): number[] {
  if (!fin(v) || v === 0) return [];
  const a = Math.abs(v);
  const out: number[] = [];
  if (Number.isInteger(v) && a >= 1000) out.push(round6(v / 1000));          // «10.000» lest som 10 000
  if (Number.isInteger(v) && a >= 100) out.push(round6(v / 100));            // «1.100,00» lest som 110 000
  const dec = (String(a).split(".")[1] ?? "").length;
  if (!Number.isInteger(v) && a < 1000 && dec <= 3) out.push(round6(v * 1000)); // «1.100» (tusen) lest som 1,1
  return [...new Set(out)].filter((x) => x !== v);
}

/** Feltet kan tolkes på nytt: ikke når trykt råtekst med skilletegn finnes. */
function reinterpretable(l: CheckLine, f: NumberField): boolean {
  const e = l.number_evidence?.find((x) => x.field === f);
  if (!e || e.how === "modelltall") return true;
  return !/[.,\s\u00a0]/.test(e.raw);
}

function arithmeticOk(l: CheckLine, isCredit: boolean): boolean {
  return lineReadIssues({
    quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, total_amount: l.total_amount,
    package_size: l.package_size, package_unit: l.package_unit, count_per_package: l.count_per_package,
    unit_price_basis: l.price_basis ?? null, discount_amount: l.discount_amount, line_kind: l.line_kind, is_credit: isCredit,
  }).length === 0;
}

/** Entydig tolkning for én linje, eller null (ingen eller flere tolkninger går opp). */
export function proposeLineFix(l: CheckLine, isCredit: boolean): NumberFix[] | null | "flere" {
  if (!fin(l.quantity) || !fin(l.unit_price) || !fin(l.total_amount)) return null;
  if (arithmeticOk(l, isCredit)) return null;
  const opts = FIELDS.map((f) => [l[f] as number, ...(reinterpretable(l, f) ? separatorAlternatives(l[f] as number) : [])]);
  let best: NumberFix[][] = [];
  let bestN = Infinity;
  for (const q of opts[0]) for (const p of opts[1]) for (const t of opts[2]) {
    const vals = [q, p, t];
    const fixes = FIELDS.flatMap((f, i) => (vals[i] !== l[f] ? [{ field: f, from: l[f] as number, to: vals[i] }] : []));
    if (fixes.length === 0 || fixes.length > bestN) continue;
    if (!arithmeticOk({ ...l, quantity: q, unit_price: p, total_amount: t }, isCredit)) continue;
    if (fixes.length < bestN) { bestN = fixes.length; best = []; }
    best.push(fixes);
  }
  if (best.length === 0) return null;
  return best.length === 1 ? best[0] : "flere";
}

const nb = (n: number) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 3 }).format(n);
const fixText = (fx: NumberFix[]) => fx.map((x) => `${LABEL[x.field]} ${nb(x.from)} → ${nb(x.to)}`).join(", ");

export interface NumberCheckResult<T> {
  lines: T[];
  /** Linjer som ble rettet (indeks + rettelser). */
  corrected: LineFixProposal[];
  /** Fakturavarsel når noe ble rettet (fakturaen skal gjennomgås), ellers null. */
  invoiceIssue: ReadIssue | null;
}

/**
 * Kjører tallkontrollen over alle linjer. `expectedExcl` er kontrollsummen eks. mva (null = ukjent).
 * Returnerer nye linjeobjekter; originalene endres ikke.
 */
export function applyNumberCheck<T extends CheckLine>(lines: readonly T[], expectedExcl: number | null, isCredit: boolean): NumberCheckResult<T> {
  const proposals: LineFixProposal[] = [];
  const ambiguous = new Set<number>();
  lines.forEach((l, index) => {
    const p = proposeLineFix(l, isCredit);
    if (p === "flere") ambiguous.add(index);
    else if (p) proposals.push({ index, fixes: p });
  });
  if (proposals.length === 0) return { lines: [...lines], corrected: [], invoiceIssue: null };

  const fixedTotal = (l: T, i: number) => {
    const t = proposals.find((p) => p.index === i)?.fixes.find((f) => f.field === "total_amount");
    return t ? t.to : l.total_amount ?? 0;
  };
  const sum = Math.round(lines.reduce((s, l, i) => s + fixedTotal(l, i), 0) * 100) / 100;
  const exp = expectedExcl != null && Number.isFinite(expectedExcl) && expectedExcl !== 0 ? creditAlignedExpected(expectedExcl, sum, isCredit) : null;
  const sumOk = exp != null && Math.abs(((sum - exp) / exp) * 100) <= LINES_SUM_TOLERANCE_PCT;

  const out = lines.map((l, i) => {
    const p = proposals.find((x) => x.index === i);
    if (!p) return l;
    if (!sumOk) {
      const why = exp == null ? "kontrollsummen er ukjent" : "linjesummen stemmer da ikke med kontrollsummen";
      return { ...l, read_issues: [...l.read_issues, { code: "mulig_tallformat", message: `Regnestykket går opp hvis ${fixText(p.fixes)} (tusenskille/desimaltegn), men ${why}. Ikke rettet – kontroller mot originalen.` }] };
    }
    const next: T = { ...l };
    for (const f of p.fixes) (next as CheckLine)[f.field] = f.to;
    const ev = (l.number_evidence ?? []).filter((e) => !p.fixes.some((f) => f.field === e.field));
    next.number_evidence = [...ev, ...p.fixes.map((f): NumberEvidence => ({ field: f.field, raw: String(f.from), value: f.to, how: "tallkontroll" }))];
    // Regnestykke-varslene er forklart av rettingen; andre lesevarsler beholdes.
    next.read_issues = l.read_issues.filter((r) => !ARITH_CODES.has(String(r.code)));
    return next;
  });
  void ambiguous;
  if (!sumOk) return { lines: out, corrected: [], invoiceIssue: null };
  const n = proposals.reduce((s, p) => s + p.fixes.length, 0);
  return {
    lines: out,
    corrected: proposals,
    invoiceIssue: {
      code: "tall_rettet",
      message: `Tallkontrollen rettet ${n} tall på ${proposals.length} linje(r) der tusenskille/desimaltegn var lest feil (${proposals.slice(0, 3).map((p) => `linje ${p.index + 1}: ${fixText(p.fixes)}`).join("; ")}${proposals.length > 3 ? " …" : ""}). Linjenes regnestykke og kontrollsummen går nå opp. Kontroller mot originalen.`,
    },
  };
}
