// Samlet gjenlesing (17.11.2026): regelen for når en ny lesing tas i bruk AUTOMATISK.
// Ren logikk (testes). Serveren (rm_apply_invoice_reread → rm_correct_invoice_line) er sannheten; dette bygger
// bare forespørselen og avgjør om den kan sendes uten spørsmål.
//
// Bruk automatisk når
//   1) dagens sumkontroll (samme regel som rm_lines_sum_check) gir «ok» for linjene slik de blir etter bruk, OG
//   2) ingen beskyttet linje går tapt:
//      - manuelt koblet linje må gjenfinnes som samme vare (samme varenummer, ellers samme tekstnøkkel OG beløp);
//        bare ikke-identitetsfelt rettes, så koblingen beholdes (rm_correct_invoice_line beholder manuell råvare).
//      - godtatt pris, «ikke vare», «holdt utenfor» og rettede linjer må gjenfinnes med samme mengde, enhet, pris,
//        rabatt og linjesum; de røres aldri (en retting ville nullstilt godtatt pris og krevd overstyring).
// Lik lesing (ingen endring) gjør ingenting. En lesing som gjør en stemmende sum til avvik brukes aldri.
// Alt annet blir «Forslag venter på deg».
import { computeLinesSum, type LinesSumCheck } from "../../../../supabase/functions/_shared/lines-sum.ts";
import { normalizeMatchKey } from "@/fakturaer/lib/matchNormalize";
import { REREAD_FIELDS, differingFields, type Operation, type RereadField, type Value, type Values } from "@/fakturaer/lib/reread";

export type Protection = "manuell_kobling" | "godtatt_pris" | "ikke_vare" | "holdt_utenfor" | "rettet";
export const PROTECTION_LABEL: Record<Protection, string> = {
  manuell_kobling: "manuelt koblet", godtatt_pris: "godtatt pris", ikke_vare: "«ikke vare»", holdt_utenfor: "holdt utenfor", rettet: "rettet",
};

export type AutoLine = Values & { id: string; line_number: number | null; protections: Protection[] };
export type AutoCandidate = { candidate_id: string; values: Values };
export type AutoInvoice = { total_amount: number | null; total_vat: number | null; is_credit_note: boolean };
export type AutoInput = { lines: AutoLine[]; candidates: AutoCandidate[]; invoice: AutoInvoice };

export type ReasonCode =
  | "sum_stemmer_ikke" | "manuell_kobling_ikke_gjenfunnet" | "beskyttet_linje_ikke_gjenfunnet"
  | "beskyttet_linje_endres" | "ny_linje_mangler_felt";
export type AutoReason = { code: ReasonCode; text: string };

export type AutoDecision =
  | { kind: "bruk"; operations: Operation[]; before: LinesSumCheck; after: LinesSumCheck; unmatchedOld: number }
  | { kind: "uendret"; before: LinesSumCheck }
  | { kind: "forslag"; operations: Operation[]; reasons: AutoReason[]; before: LinesSumCheck; after: LinesSumCheck; unmatchedOld: number }
  | { kind: "darligere"; before: LinesSumCheck; after: LinesSumCheck };

const IDENTITY: RereadField[] = ["supplier_sku", "description", "line_kind"];
/** Feltene som avgjør pris/sum. En beskyttet linje må gjenfinnes med nøyaktig disse. */
const VALUE_FIELDS: RereadField[] = ["quantity", "unit", "unit_price", "total_amount", "discount_amount"];
const ADD_REQUIRED: RereadField[] = ["description", "quantity", "unit", "unit_price", "total_amount"];
const KEEP_UNTOUCHED: Protection[] = ["godtatt_pris", "ikke_vare", "holdt_utenfor", "rettet"];

export const skuNorm = (v: Value): string => (typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9]/g, "") : "");
export const textKey = (v: Value): string => (typeof v === "string" ? normalizeMatchKey(v) : "");
const amountKey = (v: Value): string | null => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : null);

export type PairMethod = "varenummer" | "varenummer_belop" | "tekst_belop" | "tekst";
/** Metoder som regnes som «samme vare» for en manuelt koblet linje. */
const SAME_ITEM: PairMethod[] = ["varenummer", "varenummer_belop", "tekst_belop"];

type KeyFn = (x: Values) => string | null;
const KEYS: { method: PairMethod; key: KeyFn }[] = [
  { method: "varenummer", key: (x) => skuNorm(x.supplier_sku) || null },
  { method: "varenummer_belop", key: (x) => { const s = skuNorm(x.supplier_sku); const a = amountKey(x.total_amount); return s && a ? `${s}|${a}` : null; } },
  { method: "tekst_belop", key: (x) => { const t = textKey(x.description); const a = amountKey(x.total_amount); return t && a ? `${t}|${a}` : null; } },
  { method: "tekst", key: (x) => textKey(x.description) || null },
];

/** Entydige par: en nøkkel brukes bare når den er unik blant de uparede på BEGGE sider. Ingen fuzzy-matching. */
export function pairLines(cands: AutoCandidate[], lines: AutoLine[]): Map<string, { lineId: string; method: PairMethod }> {
  const out = new Map<string, { lineId: string; method: PairMethod }>();
  const usedLines = new Set<string>();
  for (const { method, key } of KEYS) {
    const freeC = cands.filter((c) => !out.has(c.candidate_id));
    const freeL = lines.filter((l) => !usedLines.has(l.id));
    const count = <T,>(xs: T[], f: (x: T) => string | null) => {
      const m = new Map<string, number>();
      for (const x of xs) { const k = f(x); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    const cc = count(freeC, (c) => key(c.values));
    const lc = count(freeL, (l) => key(l));
    for (const c of freeC) {
      const k = key(c.values);
      if (!k || cc.get(k) !== 1 || lc.get(k) !== 1) continue;
      const l = freeL.find((x) => key(x) === k);
      if (l && !usedLines.has(l.id)) { out.set(c.candidate_id, { lineId: l.id, method }); usedLines.add(l.id); }
    }
  }
  return out;
}

const lineRef = (l: AutoLine) => (l.line_number != null ? `Linje ${l.line_number}` : "En linje");
const describe = (l: AutoLine) => `${lineRef(l)} (${typeof l.description === "string" && l.description.trim() ? l.description.trim() : "uten tekst"})`;

export function sumCheckOf(totals: Value[], inv: AutoInvoice): LinesSumCheck {
  return computeLinesSum({ lineTotals: totals.map((t) => (typeof t === "number" ? t : null)), totalAmount: inv.total_amount, totalVat: inv.total_vat, isCredit: inv.is_credit_note });
}

/** Regelen. Operasjonene rører aldri en beskyttet linje utover det som beholder beskyttelsen. */
export function decideAuto(input: AutoInput): AutoDecision {
  const { lines, candidates, invoice } = input;
  const pairs = pairLines(candidates, lines);
  const pairedLine = new Map<string, { candidate: AutoCandidate; method: PairMethod }>();
  for (const c of candidates) { const p = pairs.get(c.candidate_id); if (p) pairedLine.set(p.lineId, { candidate: c, method: p.method }); }

  const operations: Operation[] = [];
  const reasons: AutoReason[] = [];
  const totals = new Map<string, Value>(lines.map((l) => [l.id, l.total_amount]));
  const adds: Value[] = [];
  let unmatchedOld = 0;

  for (const l of lines) {
    const p = pairedLine.get(l.id);
    const untouched = l.protections.filter((x) => KEEP_UNTOUCHED.includes(x));
    const manual = l.protections.includes("manuell_kobling");
    if (!p) {
      if (manual) reasons.push({ code: "manuell_kobling_ikke_gjenfunnet", text: `${describe(l)} er manuelt koblet, men finnes ikke som samme vare i ny lesing.` });
      else if (untouched.length > 0) reasons.push({ code: "beskyttet_linje_ikke_gjenfunnet", text: `${describe(l)} (${untouched.map((x) => PROTECTION_LABEL[x]).join(", ")}) finnes ikke i ny lesing.` });
      else unmatchedOld++;
      continue;
    }
    const diff = differingFields({ candidate_id: p.candidate.candidate_id, values: p.candidate.values, issues: [], evidence: { confidence: null, number_evidence: [], ean: null, vat_rate: null, discount_pct: null, model_price_basis: null } }, { ...l, issues: [], manuallyLinked: manual, corrected: l.protections.includes("rettet") });
    if (manual && !SAME_ITEM.includes(p.method)) {
      reasons.push({ code: "manuell_kobling_ikke_gjenfunnet", text: `${describe(l)} er manuelt koblet, men ny lesing har verken samme varenummer eller samme tekst og beløp.` });
      continue;
    }
    if (untouched.length > 0) {
      const changed = diff.filter((f) => VALUE_FIELDS.includes(f));
      if (changed.length > 0) reasons.push({ code: "beskyttet_linje_endres", text: `${describe(l)} (${untouched.map((x) => PROTECTION_LABEL[x]).join(", ")}) ville fått ny verdi og beholdes derfor som den er.` });
      continue; // Røres aldri.
    }
    const fields = manual ? diff.filter((f) => !IDENTITY.includes(f)) : diff;
    if (fields.length === 0) continue;
    const changes: Partial<Values> = {};
    for (const f of REREAD_FIELDS) if (fields.includes(f)) changes[f] = p.candidate.values[f];
    operations.push({ kind: "update", candidate_id: p.candidate.candidate_id, line_id: l.id, changes, confirmed_mapping: true, learn: false });
    if (fields.includes("total_amount")) totals.set(l.id, p.candidate.values.total_amount);
  }

  for (const c of candidates) {
    if (pairs.has(c.candidate_id)) continue;
    if (ADD_REQUIRED.some((f) => c.values[f] == null)) {
      reasons.push({ code: "ny_linje_mangler_felt", text: `Ny lesing har en linje (${typeof c.values.description === "string" ? c.values.description : "uten tekst"}) som mangler mengde, enhet, pris eller sum.` });
      continue;
    }
    operations.push({ kind: "add", candidate_id: c.candidate_id, changes: { ...c.values }, confirmed_addition: true });
    adds.push(c.values.total_amount);
  }

  const before = sumCheckOf(lines.map((l) => l.total_amount), invoice);
  if (operations.length === 0 && reasons.length === 0) return { kind: "uendret", before };
  const after = sumCheckOf([...totals.values(), ...adds], invoice);
  if (before.lines_sum_status === "ok" && after.lines_sum_status !== "ok") return { kind: "darligere", before, after };
  if (after.lines_sum_status !== "ok") reasons.unshift({ code: "sum_stemmer_ikke", text: "Summen stemmer fortsatt ikke med fakturaen etter ny lesing." });
  if (reasons.length > 0) return { kind: "forslag", operations, reasons, before, after, unmatchedOld };
  return { kind: "bruk", operations, before, after, unmatchedOld };
}

// ---- Lagret kjøring → regelens inndata ---------------------------------------------------------------

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const NUM: RereadField[] = ["quantity", "unit_price", "total_amount", "package_size", "count_per_package", "discount_amount"];
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
function vals(r: Rec): Values {
  const o = {} as Values;
  for (const f of REREAD_FIELDS) o[f] = NUM.includes(f) ? num(r[f]) : typeof r[f] === "string" ? (r[f] as string) : null;
  return o;
}

/** Beskyttelser på en linje i øyeblikksbildet (to_jsonb(invoice_lines) + invoice_line_corrections). */
export function protectionsOf(l: Rec, corrected: Set<string>): Protection[] {
  const p: Protection[] = [];
  if (l.match_confidence === "manual" && l.raw_material_id != null) p.push("manuell_kobling");
  if (l.price_acceptance != null) p.push("godtatt_pris");
  if (l.excluded_at != null) p.push("holdt_utenfor");
  else if (l.match_confidence === "not_applicable") p.push("ikke_vare");
  if (corrected.has(String(l.id))) p.push("rettet");
  return p;
}

/** Fra lagret kjøring (snapshot + proposal). null = ugyldig kjøring (ingen automatikk). */
export function autoInputFromRun(snapshot: unknown, proposal: unknown): AutoInput | null {
  if (!isRec(snapshot) || !isRec(proposal) || !isRec(snapshot.invoice)) return null;
  const inv = snapshot.invoice;
  const corrected = new Set(recs(snapshot.corrections).map((c) => String(c.invoice_line_id)));
  const lines: AutoLine[] = recs(snapshot.lines).map((l) => ({ ...vals(l), id: String(l.id), line_number: num(l.line_number), protections: protectionsOf(l, corrected) }));
  const candidates: AutoCandidate[] = recs(proposal.candidates)
    .filter((c) => typeof c.candidate_id === "string")
    .map((c) => ({ candidate_id: String(c.candidate_id), values: vals(isRec(c.values) ? c.values : {}) }));
  if (candidates.length === 0) return null;
  return { lines, candidates, invoice: { total_amount: num(inv.total_amount), total_vat: num(inv.total_vat), is_credit_note: inv.is_credit_note === true } };
}
