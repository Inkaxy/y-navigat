// «Les originalen på nytt»: typer, parsing av lagret kjøring, forslag til linjepar og operasjoner.
// Ren logikk — ingen nettverk. Server (rm_apply_invoice_reread) er sannheten; dette bygger bare forespørselen.
import type { Json } from "@/integrations/supabase/types";

export const REREAD_FIELDS = [
  "supplier_sku", "description", "quantity", "unit", "unit_price", "total_amount",
  "package_size", "package_unit", "count_per_package", "line_kind", "unit_price_basis", "discount_amount",
] as const;
export type RereadField = (typeof REREAD_FIELDS)[number];
export const REREAD_FIELD_LABEL: Record<RereadField, string> = {
  supplier_sku: "Varenr.", description: "Beskrivelse", quantity: "Mengde", unit: "Enhet", unit_price: "Enhetspris",
  total_amount: "Linjesum", package_size: "Pakningsstørrelse", package_unit: "Pakningsenhet", count_per_package: "Antall per pakning",
  line_kind: "Linjetype", unit_price_basis: "Prisgrunnlag", discount_amount: "Rabatt (kr)",
};
const IDENTITY: RereadField[] = ["supplier_sku", "description", "line_kind"];
const ADD_REQUIRED: RereadField[] = ["description", "quantity", "unit", "unit_price", "total_amount"];

export type Value = string | number | null;
export type Values = Record<RereadField, Value>;
export type Issue = { code: string; message: string };
export type RunStatus = "reading" | "ready" | "applied" | "cancelled" | "failed";

export type OldLine = Values & {
  id: string; line_number: number | null; issues: Issue[]; manuallyLinked: boolean; corrected: boolean;
};
export type Candidate = {
  candidate_id: string; values: Values; issues: Issue[];
  evidence: { confidence: number | null; number_evidence: { field: string; raw: string }[]; ean: string | null; vat_rate: number | null; discount_pct: number | null; model_price_basis: string | null };
};
export type HeaderCompare = { label: string; old: Value; next: Value }[];
export type RereadRun = {
  id: string; invoice_id: string; legal_entity_id: string; created_by: string; status: RunStatus; error_code: string | null;
  created_at: string; expires_at: string; document_path: string;
  invoice: { invoice_number: string | null; is_credit_note: boolean; total_amount: number | null; total_vat: number | null; currency: string | null; issues: Issue[] };
  oldLines: OldLine[];
  candidates: Candidate[];
  invoiceIssues: Issue[];
  header: HeaderCompare;
  readCredit: boolean | null;
  extractor: { method: string | null; confidence: number | null; warningCount: number };
  result: ApplyResult | null;
  appliedOperations: Json | null;
  applyReason: string | null;
};
export type ApplyResult = { ok: boolean; applied_count: number; lines_sum_status: string | null; replayed: boolean; operations: { kind: string; candidate_id: string; line_id: string | null }[] };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.flatMap((x: unknown) => (isRec(x) ? [x] : [])) : []);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const NUM_FIELDS: RereadField[] = ["quantity", "unit_price", "total_amount", "package_size", "count_per_package", "discount_amount"];

function values(r: Rec): Values {
  const out = {} as Values;
  for (const f of REREAD_FIELDS) out[f] = NUM_FIELDS.includes(f) ? numOrNull(r[f]) : strOrNull(r[f]);
  return out;
}
export function parseIssues(v: unknown): Issue[] {
  return Array.isArray(v) ? recs(v).map((i) => ({ code: String(i.code ?? "lesevarsel"), message: String(i.message ?? i.code ?? "Lesevarsel") })) : [];
}
const STATUSES: RunStatus[] = ["reading", "ready", "applied", "cancelled", "failed"];

export type RunRowInput = {
  id: string; invoice_id: string; legal_entity_id: string; created_by: string; status: string; error_code: string | null;
  created_at: string; expires_at: string; document_path: string; snapshot: Json; proposal: Json | null; extractor: Json | null;
  result: Json | null; applied_operations: Json | null; apply_reason: string | null;
};

export function parseRun(row: RunRowInput): RereadRun {
  const snap = isRec(row.snapshot) ? row.snapshot : {};
  const inv = isRec(snap.invoice) ? snap.invoice : {};
  const corrected = new Set(recs(snap.corrections).map((c) => String(c.invoice_line_id)));
  const oldLines: OldLine[] = recs(snap.lines).map((l) => ({
    ...values(l), id: String(l.id), line_number: numOrNull(l.line_number), issues: parseIssues(l.extraction_issues),
    manuallyLinked: l.match_confidence === "manual" && l.raw_material_id != null, corrected: corrected.has(String(l.id)),
  })).sort((a, b) => (a.line_number ?? 1e9) - (b.line_number ?? 1e9));
  const prop = isRec(row.proposal) ? row.proposal : {};
  const candidates: Candidate[] = recs(prop.candidates).map((c) => {
    const ev = isRec(c.evidence) ? c.evidence : {};
    return {
      candidate_id: String(c.candidate_id), values: values(isRec(c.values) ? c.values : {}), issues: parseIssues(c.issues),
      evidence: {
        confidence: numOrNull(ev.confidence),
        number_evidence: recs(ev.number_evidence).map((e) => ({ field: String(e.field ?? ""), raw: String(e.raw ?? "") })),
        ean: strOrNull(ev.ean), vat_rate: numOrNull(ev.vat_rate), discount_pct: numOrNull(ev.discount_pct), model_price_basis: strOrNull(ev.model_price_basis),
      },
    };
  });
  const head = isRec(prop.header) ? prop.header : {};
  const read = isRec(head.read) ? head.read : {};
  const header: HeaderCompare = [
    { label: "Fakturanr.", old: strOrNull(inv.invoice_number), next: strOrNull(read.invoice_number) },
    { label: "Fakturadato", old: strOrNull(inv.invoice_date), next: strOrNull(read.invoice_date) },
    { label: "Total inkl. mva", old: numOrNull(inv.total_amount), next: numOrNull(read.total_amount) },
    { label: "Mva", old: numOrNull(inv.total_vat), next: numOrNull(read.total_vat) },
    { label: "Valuta", old: strOrNull(inv.currency), next: strOrNull(read.currency) },
  ];
  const ex = isRec(row.extractor) ? row.extractor : {};
  const res = isRec(row.result) ? row.result : null;
  const readTotal = numOrNull(read.total_amount);
  return {
    id: row.id, invoice_id: row.invoice_id, legal_entity_id: row.legal_entity_id, created_by: row.created_by,
    status: (STATUSES as string[]).includes(row.status) ? (row.status as RunStatus) : "failed",
    error_code: row.error_code, created_at: row.created_at, expires_at: row.expires_at, document_path: row.document_path,
    invoice: { invoice_number: strOrNull(inv.invoice_number), is_credit_note: inv.is_credit_note === true, total_amount: numOrNull(inv.total_amount), total_vat: numOrNull(inv.total_vat), currency: strOrNull(inv.currency), issues: parseIssues(inv.extraction_issues) },
    oldLines, candidates, invoiceIssues: parseIssues(prop.invoice_issues), header,
    readCredit: readTotal == null ? null : readTotal < 0,
    extractor: { method: strOrNull(ex.extraction_method), confidence: numOrNull(ex.confidence), warningCount: numOrNull(ex.warning_count) ?? 0 },
    result: res ? {
      ok: res.ok === true, applied_count: numOrNull(res.applied_count) ?? 0, lines_sum_status: strOrNull(res.lines_sum_status), replayed: res.replayed === true,
      operations: recs(res.operations).map((o) => ({ kind: String(o.kind), candidate_id: String(o.candidate_id), line_id: strOrNull(o.line_id) })),
    } : null,
    appliedOperations: row.applied_operations, applyReason: row.apply_reason,
  };
}

const norm = (s: Value) => (typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, " ") : null);

/**
 * Forslag til gammel linje: bare ved entydig lik varenummer (begge sider unike), ellers likt varenavn
 * på samme måte. Er bare et forslag — brukeren må bekrefte. Ingen fuzzy-matching.
 */
export function suggestPairs(cands: Candidate[], lines: OldLine[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const key of ["supplier_sku", "description"] as const) {
    const count = <T,>(xs: T[], f: (x: T) => string | null) => { const m = new Map<string, number>(); xs.forEach((x) => { const k = f(x); if (k) m.set(k, (m.get(k) ?? 0) + 1); }); return m; };
    const cc = count(cands, (c) => norm(c.values[key]));
    const lc = count(lines, (l) => norm(l[key]));
    for (const c of cands) {
      if (out[c.candidate_id]) continue;
      const k = norm(c.values[key]);
      if (!k || cc.get(k) !== 1 || lc.get(k) !== 1) continue;
      const l = lines.find((x) => norm(x[key]) === k);
      if (l && !used.has(l.id)) { out[c.candidate_id] = l.id; used.add(l.id); }
    }
  }
  return out;
}

export function sameValue(a: Value, b: Value): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return (a ?? null) === (b ?? null);
}
export function differingFields(c: Candidate, l: OldLine): RereadField[] {
  return REREAD_FIELDS.filter((f) => !sameValue(c.values[f], l[f]));
}

export type Selection = {
  /** null = ikke valgt (standard). */
  target: string | "add" | null;
  fields: RereadField[];
  confirmed: boolean;
  overrideManual: boolean;
  manualReason: string;
  confirmIdentity: boolean;
};
export const emptySelection = (): Selection => ({ target: null, fields: [], confirmed: false, overrideManual: false, manualReason: "", confirmIdentity: false });

export type SelectionProblem = string | null;
export function selectionProblem(c: Candidate, s: Selection, lines: OldLine[], all: Record<string, Selection>): SelectionProblem {
  if (s.target === null) return null;
  if (s.target === "add") {
    if (ADD_REQUIRED.some((f) => c.values[f] == null)) return "Forslaget mangler beskrivelse, mengde, enhet, pris eller sum og kan ikke legges til.";
    if (!s.confirmed) return "Bekreft at linjen mangler i dag og skal legges til.";
    return null;
  }
  const l = lines.find((x) => x.id === s.target);
  if (!l) return "Linjen finnes ikke lenger.";
  if (Object.entries(all).some(([cid, o]) => cid !== c.candidate_id && o.target === s.target)) return "Linjen er valgt for et annet forslag.";
  if (s.fields.length === 0) return "Velg minst ett felt som skal rettes.";
  if (!s.confirmed) return "Bekreft at forslaget gjelder denne linjen.";
  if (l.corrected && (!s.overrideManual || s.manualReason.trim().length < 3)) return "Linjen er rettet manuelt før. Huk av og begrunn hvis den skal overskrives.";
  if (l.manuallyLinked && s.fields.some((f) => IDENTITY.includes(f) && !sameValue(c.values[f], l[f])) && !s.confirmIdentity)
    return "Linjen er koblet manuelt. Endring av varenr./navn/type fjerner koblingen — bekreft dette.";
  return null;
}
export const identityChange = (c: Candidate, s: Selection, l: OldLine | undefined) =>
  !!l && s.fields.some((f) => IDENTITY.includes(f) && !sameValue(c.values[f], l[f]));

export type Operation =
  | { kind: "update"; candidate_id: string; line_id: string; changes: Partial<Values>; confirmed_mapping: true; learn: false; override_manual?: true; manual_reason?: string; confirm_identity_change?: true }
  | { kind: "add"; candidate_id: string; changes: Values; confirmed_addition: true };

/** Valg → nøyaktig operasjonsliste. Verdiene er alltid forslagets egne (ingen brukerredigering i denne versjonen). */
export function buildOperations(cands: Candidate[], sel: Record<string, Selection>, lines: OldLine[]): Operation[] {
  const ops: Operation[] = [];
  for (const c of cands) {
    const s = sel[c.candidate_id];
    if (!s || s.target === null || selectionProblem(c, s, lines, sel)) continue;
    if (s.target === "add") { ops.push({ kind: "add", candidate_id: c.candidate_id, changes: { ...c.values }, confirmed_addition: true }); continue; }
    const l = lines.find((x) => x.id === s.target);
    const changes: Partial<Values> = {};
    for (const f of REREAD_FIELDS) if (s.fields.includes(f)) changes[f] = c.values[f];
    const op: Operation = { kind: "update", candidate_id: c.candidate_id, line_id: s.target, changes, confirmed_mapping: true, learn: false };
    if (l?.corrected) { op.override_manual = true; op.manual_reason = s.manualReason.trim(); }
    if (l?.manuallyLinked && identityChange(c, s, l)) op.confirm_identity_change = true;
    ops.push(op);
  }
  return ops;
}

const ERR: Record<string, string> = {
  snapshot_endret: "Fakturaen eller originalen er endret siden lesingen startet. Forslaget kan ikke brukes — start en ny lesing.",
  reread_utlopt: "Forslaget er eldre enn 24 timer. Start en ny lesing.",
  reread_ikke_klar: "Lesingen er ikke klar, eller er avbrutt.",
  allerede_brukt_med_andre_valg: "Forslaget er allerede tatt i bruk med andre valg.",
  tidligere_rettelse_beskyttet: "En valgt linje er rettet manuelt før og må overstyres med begrunnelse.",
  manuell_kobling_ma_avklares: "En valgt linje er koblet manuelt; endring av varen må bekreftes.",
  linjekobling_ma_bekreftes: "Hver valgt linje må bekreftes.",
  ny_linje_ma_bekreftes: "Nye linjer må bekreftes.",
  faktura_last: "Fakturaen er avstemt eller lukket.",
  faktura_flagget: "Fakturaen er flagget. Fjern flagget først.",
  faktura_godkjent: "Fakturaen er godkjent internt og kan ikke endres.",
  kostpris_fort: "Kostpris er ført fra fakturaen; linjene er låst.",
  forbidden: "Du kan ikke bruke denne lesingen. Bare den som startet den, med skrivetilgang, kan ta den i bruk.",
  annen_eier: "Lesingen ble startet av en annen bruker.",
  dokument_mangler: "Originaldokumentet finnes ikke.",
  dokumentsti_avvist: "Originaldokumentet ligger ikke der det skal for selskapet, og ble ikke lest.",
  ikke_pdf: "Originalen er ikke en PDF som kan leses på nytt.",
  leser_feilet: "Fakturaleseren svarte ikke. Prøv en ny lesing.",
  leser_ugyldig_svar: "Fakturaleseren ga et ugyldig svar. Ingenting er endret.",
  leser_ingen_linjer: "Leseren fant ingen linjer i originalen. Ingenting kan tas i bruk.",
  for_mange_linjer: "Leseren fant flere enn 500 linjer. Ingenting kan tas i bruk.",
  forslag_for_stort: "Lesingen ble for stor til å lagres. Ingenting er endret.",
  forslag_avvist: "Lesingen ble avvist av kontrollen i databasen. Ingenting er endret.",
  begrunnelse_mangler: "Skriv en begrunnelse (minst 3 tegn).",
  omberegning_kunne_ikke_koes: "Ny beregning kunne ikke legges i kø; ingenting ble lagret.",
};
/** Kode → norsk forklaring. Ukjent kode gir generell tekst, aldri rå backendtekst. */
export function rereadErrorText(codeOrMessage: string | null | undefined): string {
  if (!codeOrMessage) return "Noe gikk galt. Ingenting er endret.";
  const key = Object.keys(ERR).find((k) => codeOrMessage === k || codeOrMessage.includes(k));
  return key ? ERR[key] : "Noe gikk galt. Ingenting er endret.";
}

// Ventende «ta i bruk»: lagres før kallet så et ukjent utfall bare kan prøves på nytt med nøyaktig samme valg.
export type PendingApply = { runId: string; operations: Operation[]; reason: string };
const pendingKey = (runId: string) => `nbhub.reread.apply.${runId}`;
export function savePending(p: PendingApply, store: Pick<Storage, "setItem"> = sessionStorage) { store.setItem(pendingKey(p.runId), JSON.stringify(p)); }
export function loadPending(runId: string, store: Pick<Storage, "getItem"> = sessionStorage): PendingApply | null {
  const raw = store.getItem(pendingKey(runId));
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!isRec(p) || p.runId !== runId || !Array.isArray(p.operations) || typeof p.reason !== "string") return null;
    const ops = p.operations.filter(isOperation);
    return ops.length === p.operations.length ? { runId, reason: p.reason, operations: ops } : null;
  } catch (e) {
    console.error("[reread-pending]", e);
    return null;
  }
}
function isOperation(x: unknown): x is Operation {
  return isRec(x) && typeof x.candidate_id === "string" && isRec(x.changes) && (x.kind === "add" ? x.confirmed_addition === true : x.kind === "update" && typeof x.line_id === "string" && x.confirmed_mapping === true);
}
export function clearPending(runId: string, store: Pick<Storage, "removeItem"> = sessionStorage) { store.removeItem(pendingKey(runId)); }
