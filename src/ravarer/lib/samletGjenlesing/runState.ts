// Samlet gjenlesing: lagret kjøretilstand (tåler omlasting), feilklassifisering, ventetid og kvittering.
// Ren logikk (testes).
import type { Operation } from "@/fakturaer/lib/reread";
import { rereadErrorText } from "@/fakturaer/lib/reread";
import type { SkipReason } from "./plan";

export type Outcome = "brukt" | "uendret" | "forslag" | "darligere" | "hoppet_over" | "feilet";
export const OUTCOMES: Outcome[] = ["brukt", "uendret", "forslag", "darligere", "hoppet_over", "feilet"];
export const OUTCOME_LABEL: Record<Outcome, string> = {
  brukt: "Brukt automatisk",
  uendret: "Uendret (lik lesing)",
  forslag: "Forslag venter på deg",
  darligere: "Beholdt dagens (ny lesing var dårligere)",
  hoppet_over: "Hoppet over",
  feilet: "Feilet",
};

/** queued → begin_sent → reading → (applying) → done. Lagres før hvert kall, så omlasting vet hvor den slapp. */
export type Phase = "queued" | "begin_sent" | "reading" | "applying" | "done";
export interface RunItem {
  invoiceId: string; label: string; phase: Phase; runId: string | null; attempts: number;
  beginAt: string | null; outcome: Outcome | null; code: string | null; ops: Operation[] | null;
}
export type RunStatus = "running" | "paused" | "stopped" | "done";
export interface BulkRunState {
  v: 1; id: string; legalEntityId: string; userId: string; startedAt: string; dateLabel: string;
  status: RunStatus; pauseReason: string | null; items: RunItem[];
  plannedSkips: Partial<Record<SkipReason, number>>;
}

export const MAX_ATTEMPTS = 2; // ett nytt forsøk per faktura
export const CONCURRENCY = 3;

export const storageKey = (le: string, uid: string) => `nbhub.samlet-gjenlesing.v1:${le}:${uid}`;
export const leaseKey = (le: string, uid: string) => `nbhub.samlet-gjenlesing.lease.v1:${le}:${uid}`;

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const PHASES: Phase[] = ["queued", "begin_sent", "reading", "applying", "done"];
const STATUSES: RunStatus[] = ["running", "paused", "stopped", "done"];
const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);

function parseItem(x: unknown): RunItem | null {
  if (!isRec(x) || typeof x.invoiceId !== "string" || typeof x.label !== "string" || !PHASES.includes(x.phase as Phase) || typeof x.attempts !== "number") return null;
  const outcome = x.outcome == null ? null : OUTCOMES.includes(x.outcome as Outcome) ? (x.outcome as Outcome) : undefined;
  if (outcome === undefined) return null;
  const ops = x.ops == null ? null : Array.isArray(x.ops) ? (x.ops as Operation[]) : undefined;
  if (ops === undefined) return null;
  return { invoiceId: x.invoiceId, label: x.label, phase: x.phase as Phase, runId: strOrNull(x.runId), attempts: x.attempts, beginAt: strOrNull(x.beginAt), outcome, code: strOrNull(x.code), ops };
}

/** Streng lesing. Feil form, annet selskap eller annen bruker = ingen tilstand (aldri halvveis gjetning). */
export function parseState(raw: string | null, le: string, uid: string): BulkRunState | null {
  if (!raw) return null;
  let p: unknown;
  try { p = JSON.parse(raw); } catch { return null; }
  if (!isRec(p) || p.v !== 1 || p.legalEntityId !== le || p.userId !== uid || typeof p.id !== "string" || !STATUSES.includes(p.status as RunStatus) || !Array.isArray(p.items)) return null;
  const items = p.items.map(parseItem);
  if (items.some((i) => i === null)) return null;
  return {
    v: 1, id: p.id, legalEntityId: le, userId: uid, startedAt: String(p.startedAt ?? ""), dateLabel: String(p.dateLabel ?? ""),
    status: p.status as RunStatus, pauseReason: strOrNull(p.pauseReason), items: items as RunItem[],
    plannedSkips: isRec(p.plannedSkips) ? (p.plannedSkips as Partial<Record<SkipReason, number>>) : {},
  };
}

/** Etter omlasting: en kjøring som sto «running» fortsetter først når brukeren trykker «Fortsett». */
export function afterReload(s: BulkRunState): BulkRunState {
  return s.status === "running" ? { ...s, status: "paused", pauseReason: "Siden ble lastet på nytt. Trykk «Fortsett» for å fortsette der kjøringen slapp." } : s;
}

export type Lease = { tabId: string; at: number };
export const LEASE_MS = 20_000;
export function parseLease(raw: string | null): Lease | null {
  try { const p: unknown = raw ? JSON.parse(raw) : null; return isRec(p) && typeof p.tabId === "string" && typeof p.at === "number" ? { tabId: p.tabId, at: p.at } : null; } catch { return null; }
}
/** En annen fane eier kjøringen når den har fornyet låsen nylig. */
export const otherTabOwns = (l: Lease | null, tabId: string, now: number) => !!l && l.tabId !== tabId && now - l.at < LEASE_MS;

export type FailureKind = "retry" | "skip" | "pause_all" | "fail";
const SKIP = new Set(["faktura_last", "faktura_flagget", "faktura_godkjent", "kostpris_fort", "dokument_mangler", "ikke_pdf", "dokumentsti_avvist"]);
const PAUSE_ALL = new Set(["ai_feil_nokkel", "forbidden", "annen_eier", "not_authenticated"]);
const NO_RETRY = new Set(["leser_ingen_linjer", "for_mange_linjer", "forslag_for_stort", "finnes_ikke"]);
/** Hoppes over (fakturaen kan ikke leses), stopp alt (nøkkel/tilgang), feil uten nytt forsøk, ellers ett nytt forsøk. */
export function classifyFailure(code: string | null): FailureKind {
  const c = code ?? "ukjent";
  if (SKIP.has(c)) return "skip";
  if (PAUSE_ALL.has(c)) return "pause_all";
  if (NO_RETRY.has(c)) return "fail";
  return "retry";
}
/** Ventetid ved 429/5xx/AI-feil: 15 s, 30 s, 60 s … høyst 2 min, nullstilles ved første vellykkede lesing. */
export const backoffMs = (consecutive: number) => Math.min(120_000, 15_000 * 2 ** Math.max(0, consecutive - 1));

const EXTRA: Record<string, string> = {
  tidsavbrudd: "Lesingen ble ikke ferdig innen tidsgrensen.",
  ukjent_utfall: "Utfallet er ukjent. Kontroller fakturaen.",
  ukjent_utfall_bruk: "Det er ukjent om ny lesing ble tatt i bruk. Åpne fakturaen og kontroller før noe gjøres på nytt.",
  avbrutt: "Lesingen ble avbrutt utenfor kjøringen.",
  nettverk: "Kontakten med serveren brøt.",
  http_429: "Tjenesten ba oss vente (for mange forespørsler).",
  http_5xx: "Serveren svarte med feil.",
  ugyldig_forslag: "Ny lesing kunne ikke tolkes.",
  brukt_av_andre: "Lesingen ble tatt i bruk utenfor kjøringen.",
  pagaende: "En lesing pågår allerede.",
};
export const codeText = (code: string | null) => (code && EXTRA[code]) || rereadErrorText(code);

export interface RunCounts { total: number; done: number; inProgress: number; byOutcome: Record<Outcome, number>; byCode: Record<Outcome, Record<string, number>> }
export function runCounts(s: BulkRunState): RunCounts {
  const byOutcome = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  const byCode = Object.fromEntries(OUTCOMES.map((o) => [o, {}])) as Record<Outcome, Record<string, number>>;
  let done = 0, inProgress = 0;
  for (const i of s.items) {
    if (i.phase === "done" && i.outcome) {
      done++; byOutcome[i.outcome]++;
      const k = i.code ?? "";
      byCode[i.outcome][k] = (byCode[i.outcome][k] ?? 0) + 1;
    } else if (i.phase !== "queued") inProgress++;
  }
  return { total: s.items.length, done, inProgress, byOutcome, byCode };
}

/** Begrunnelse i revisjonsloggen for automatisk bruk (rm_apply_invoice_reread lagrer den). */
export const autoApplyReason = (dateLabel: string) =>
  `Samlet gjenlesing ${dateLabel}: brukt automatisk – summen stemmer, og ingen manuelle koblinger, godtatte priser, «ikke vare», holdt utenfor eller rettede linjer berøres.`;
/** Begrunnelse når Henrik selv trykker «Bruk» på et forslag. */
export const manualApplyReason = (dateLabel: string) => `Samlet gjenlesing ${dateLabel}: forslag brukt etter gjennomgang.`;
