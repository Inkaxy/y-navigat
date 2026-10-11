import type { CountLinePayload } from "@/ravarer/lib/rpcContracts";
import type { CountResultRow } from "@/ravarer/lib/rpcContracts";

/**
 * Innsendt, uavklart varetelling.
 *
 * `rm_stock_count_apply_v2` hasher den ORDNEDE linjelisten og gir lagret resultat
 * tilbake for samme operasjons-ID. Et nytt forsøk etter tapt svar må derfor sende
 * nøyaktig de samme linjene i samme rekkefølge — ikke bygge dem på nytt fra
 * redigerbare felt eller tabellens sortering. Innsendingen lagres FØR kallet og
 * fjernes bare når utfallet er avklart (bokført eller bevist avvist).
 */
export interface PendingCountSubmission {
  legalEntityId: string;
  opId: string;
  lines: CountLinePayload[];
  note: string;
  sentAt: string;
}

const PREFIX = "nbhub:rm-count-submit:";

export function submissionKey(legalEntityId: string): string {
  return `${PREFIX}${legalEntityId}`;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optText = (v: unknown): v is string | null | undefined => v == null || typeof v === "string";

function parseLine(v: unknown): CountLinePayload | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.raw_material_id !== "string" || !o.raw_material_id) return null;
  if (!isFiniteNumber(o.counted_base) || !isFiniteNumber(o.expected_base)) return null;
  if (!optText(o.line_note) || !optText(o.location)) return null;
  // Nøklene gjenskapes i fast rekkefølge; jsonb normaliserer uansett nøkkelrekkefølgen.
  return {
    raw_material_id: o.raw_material_id,
    counted_base: o.counted_base,
    expected_base: o.expected_base,
    line_note: (o.line_note as string | null | undefined) ?? null,
    location: (o.location as string | null | undefined) ?? null,
  };
}

/** Streng lesing; ugyldig innhold er ikke en innsending (og overskriver ingenting). */
export function parsePendingSubmission(v: unknown): PendingCountSubmission | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.legalEntityId !== "string" || typeof o.opId !== "string" || !o.opId) return null;
  if (typeof o.note !== "string" || typeof o.sentAt !== "string" || !Array.isArray(o.lines) || o.lines.length === 0) return null;
  const lines: CountLinePayload[] = [];
  for (const raw of o.lines) {
    const l = parseLine(raw);
    if (!l) return null;
    lines.push(l);
  }
  return { legalEntityId: o.legalEntityId, opId: o.opId, lines, note: o.note, sentAt: o.sentAt };
}

export function loadPendingSubmission(legalEntityId: string | null | undefined): PendingCountSubmission | null {
  if (!legalEntityId) return null;
  try {
    const raw = localStorage.getItem(submissionKey(legalEntityId));
    if (!raw) return null;
    const parsed = parsePendingSubmission(JSON.parse(raw));
    return parsed && parsed.legalEntityId === legalEntityId ? parsed : null;
  } catch (e) {
    console.warn("[varetelling] kunne ikke lese uavklart innsending", e);
    return null;
  }
}

/** Returnerer false når lagringen feilet — da skal innsendingen ikke sendes. */
export function savePendingSubmission(s: PendingCountSubmission): boolean {
  try {
    localStorage.setItem(submissionKey(s.legalEntityId), JSON.stringify(s));
    return true;
  } catch (e) {
    console.warn("[varetelling] kunne ikke lagre innsending lokalt", e);
    return false;
  }
}

export function clearPendingSubmission(legalEntityId: string): void {
  try {
    localStorage.removeItem(submissionKey(legalEntityId));
  } catch (e) {
    console.warn("[varetelling] kunne ikke fjerne innsending", e);
  }
}

/* ------------------------------------------------------------------ */
/* Resultatkontrakt                                                    */
/* ------------------------------------------------------------------ */

export interface CountResult {
  ok: true;
  adjusted: number;
  unchanged: number;
  rows: CountResultRow[];
  alreadyApplied: boolean;
  /** Bokført (bevist via already_applied), men lagret resultat mangler detaljer. */
  detailsUnavailable: boolean;
  opId: string;
}

export type CountRejectionKind = "conflict" | "content" | "access" | "rejected";

/** Serveren avviste tellingen; transaksjonen er rullet tilbake. */
export class CountRejectedError extends Error {
  constructor(public kind: CountRejectionKind, message: string) {
    super(message);
    this.name = "CountRejectedError";
  }
}

/** Vi vet ikke om tellingen ble bokført. Samme innsending må sendes på nytt. */
export class CountOutcomeUnknownError extends Error {
  constructor(message = "Vi vet ikke om tellingen ble bokført. Send samme telling på nytt for å få svaret — den føres aldri to ganger.") {
    super(message);
    this.name = "CountOutcomeUnknownError";
  }
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const nonNegInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

/** Normal resultatrad: før/talt/differanse er påkrevd og endelige. */
function parseRow(v: unknown): CountResultRow | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.raw_material_id !== "string" || !o.raw_material_id) return null;
  if (!fin(o.before) || !fin(o.counted) || !fin(o.diff)) return null;
  return { raw_material_id: o.raw_material_id, name: typeof o.name === "string" ? o.name : null, before: o.before, counted: o.counted, diff: o.diff };
}

const EPS = 1e-6;

/**
 * Leser svaret fra `rm_stock_count_apply_v2` strengt. Et uventet svar betyr
 * UKJENT utfall — aldri «ingenting er bokført».
 *
 * Komplett resultat: riktig op_id, ikke-negative heltall, nøyaktig én rad per sendt vare,
 * og talt mengde/differanse stemmer med den frosne innsendingen.
 * Eneste reserve: `{ok:true, already_applied:true}` uten op_id/rader/tellere (lagret resultat
 * var null). Serveren har da kontrollert samme ID + innhold; detaljer mangler.
 */
export function parseCountResult(
  data: unknown,
  sent: { opId: string; materialIds: string[]; countedById?: Record<string, number> },
): CountResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new CountOutcomeUnknownError();
  const o = data as Record<string, unknown>;
  if (o.ok === false) {
    throw new CountRejectedError("rejected", typeof o.error === "string" ? o.error : "Serveren avviste tellingen.");
  }
  if (o.ok !== true) throw new CountOutcomeUnknownError();
  const alreadyApplied = o.already_applied === true;

  const bareFallback = alreadyApplied && o.op_id == null && o.rows == null && o.adjusted == null && o.unchanged == null;
  if (bareFallback) {
    return { ok: true, adjusted: 0, unchanged: 0, rows: [], alreadyApplied: true, detailsUnavailable: true, opId: sent.opId };
  }
  if (o.op_id !== sent.opId) throw new CountOutcomeUnknownError();
  if (!nonNegInt(o.adjusted) || !nonNegInt(o.unchanged) || !Array.isArray(o.rows)) throw new CountOutcomeUnknownError();
  if (o.adjusted + o.unchanged !== sent.materialIds.length) throw new CountOutcomeUnknownError();
  const want = new Set(sent.materialIds);
  if (want.size !== sent.materialIds.length || o.rows.length !== want.size) throw new CountOutcomeUnknownError();
  const seen = new Set<string>();
  const rows: CountResultRow[] = [];
  for (const raw of o.rows) {
    const r = parseRow(raw);
    if (!r || !want.has(r.raw_material_id) || seen.has(r.raw_material_id)) throw new CountOutcomeUnknownError();
    seen.add(r.raw_material_id);
    if (Math.abs((r.counted as number) - (r.before as number) - (r.diff as number)) > EPS) throw new CountOutcomeUnknownError();
    const frozen = sent.countedById?.[r.raw_material_id];
    if (frozen != null && Math.abs(frozen - (r.counted as number)) > EPS) throw new CountOutcomeUnknownError();
    rows.push(r);
  }
  return { ok: true, adjusted: o.adjusted, unchanged: o.unchanged, rows, alreadyApplied, detailsUnavailable: false, opId: sent.opId };
}

/** Klassifiserer en feil fra RPC-kallet. Bare kjente serverkoder er bevist avvisning. */
export function classifyCountError(error: { code?: string | null; message?: string | null } | null | undefined): Error {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "40001") {
    return new CountRejectedError("conflict", message || "Beholdningen er endret av andre siden tellingen startet.");
  }
  if (code === "23505") {
    return new CountRejectedError("content", "Operasjons-ID-en er allerede brukt med et annet innhold. Tellingen er ikke ført på nytt.");
  }
  if (code === "42501" || code === "28000") {
    return new CountRejectedError("access", message || "Mangler tilgang til å bokføre tellingen.");
  }
  // PostgREST-/Postgres-feil med kode (P0001, 22xxx, 23xxx …) betyr at transaksjonen avbrøt.
  if (/^(P0|22|23|42)/.test(code)) return new CountRejectedError("rejected", message || "Serveren avviste tellingen.");
  return new CountOutcomeUnknownError();
}
