// Klassifisering av feil fra AI-tjenesten for fakturalesingen. Ren modul (vitest + Deno).
//
// Hvorfor: et AI-kall som feiler (avvist nøkkel, brukt kvote, nede, nettverk, tidsavbrudd) er IKKE
// det samme som «AI svarte, men fant ingen linjer». Før ble begge til «PDF-en ga ingen lesbare linjer».
//  - systemic = feilen gjelder tjenesten, ikke denne fakturaen (nøkkel/kvote/nede/nettverk/oppsett).
//    Da stoppes kjøringen og forsøket skal ikke telles mot fakturaen.
//  - Meldingene er på norsk og forteller hva som feilet; rå leverandørtekst vises aldri i UI.

export type AiFailureKind =
  | "auth" | "quota" | "unavailable" | "network" | "timeout" | "incomplete" | "refusal" | "config" | "other";

export interface AiFailure {
  kind: AiFailureKind;
  /** Gjelder tjenesten (alle fakturaer), ikke denne fakturaen. */
  systemic: boolean;
  httpStatus: number | null;
  provider: string | null;
  /** Norsk tekst som kan lagres på fakturaen og vises. Starter alltid med AI_FAILURE_PREFIX. */
  message: string;
}

/** Felles start på feiltekster fra AI-feil, slik at varsler kan kjenne dem igjen. */
export const AI_FAILURE_PREFIX = "AI-tjenesten";

const SYSTEMIC: ReadonlySet<AiFailureKind> = new Set(["auth", "quota", "unavailable", "network", "config"]);

const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", azure_openai: "Azure OpenAI" };
export const providerLabel = (p: string | null | undefined) => (p ? PROVIDER_LABEL[p] ?? p : null);

function textOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "";
}

function statusOf(e: unknown, text: string): number | null {
  if (e && typeof e === "object" && "httpStatus" in e) {
    const s = (e as { httpStatus: unknown }).httpStatus;
    if (typeof s === "number" && Number.isFinite(s)) return s;
  }
  const m = /\b(?:OpenAI|Anthropic|Azure OpenAI)\s+(\d{3})\b/.exec(text);
  return m ? Number(m[1]) : null;
}

function kindOf(e: unknown): string | null {
  if (e && typeof e === "object" && "kind" in e && typeof (e as { kind: unknown }).kind === "string") return (e as { kind: string }).kind;
  return null;
}

/** Norsk feiltekst per type. */
export function aiFailureMessage(kind: AiFailureKind, provider: string | null, status: number | null): string {
  const who = providerLabel(provider);
  const tag = who ? ` (${who}${status != null ? ` ${status}` : ""})` : status != null ? ` (${status})` : "";
  switch (kind) {
    case "auth": return `${AI_FAILURE_PREFIX} avviste nøkkelen${tag}. Legg inn ny nøkkel under AI-tjenester.`;
    case "quota": return `${AI_FAILURE_PREFIX} avviste kallet fordi kvoten eller kreditten er brukt opp${tag}.`;
    case "unavailable": return `${AI_FAILURE_PREFIX} er utilgjengelig eller modellen finnes ikke${tag}.`;
    case "network": return `${AI_FAILURE_PREFIX} kunne ikke nås (nettverksfeil)${tag}.`;
    case "timeout": return `${AI_FAILURE_PREFIX} svarte ikke innen fristen${tag}.`;
    case "incomplete": return `${AI_FAILURE_PREFIX} ga et ufullstendig svar (kuttet)${tag}.`;
    case "refusal": return `${AI_FAILURE_PREFIX} avslo å lese dokumentet${tag}.`;
    case "config": return `${AI_FAILURE_PREFIX} for fakturalesing er ikke satt opp riktig. Kontroller AI-tjenester.`;
    default: return `${AI_FAILURE_PREFIX} feilet${tag}.`;
  }
}

/**
 * Klassifiserer en feil fra callAi (AiCallError eller vanlig Error) eller en lagret feiltekst
 * fra ai_usage_log («OpenAI 401: …»). Ukjent blir «other» (ikke systemisk).
 */
export function classifyAiFailure(e: unknown, provider: string | null = null): AiFailure {
  const text = textOf(e);
  const status = statusOf(e, text);
  const k = kindOf(e);
  const low = text.toLowerCase();
  let kind: AiFailureKind;
  if (status === 401 || status === 403 || /invalid(ated)?[_ ]api[_ ]key|incorrect api key|api key has been invalidated|authentication|api-key er tom|unauthori[sz]ed|avviste nøkkelen/i.test(text)) kind = "auth";
  else if (status === 429 || status === 402 || /insufficient_quota|quota|billing|credit balance|rate limit|kvoten/i.test(low)) kind = "quota";
  else if (k === "timeout" || /svarte ikke innen|timed? ?out|deadline/i.test(low)) kind = "timeout";
  else if (k === "incomplete" || /ufullstendig|max_output_tokens|max_tokens/i.test(low)) kind = "incomplete";
  else if (k === "refusal" || /avslo forespørselen/i.test(low)) kind = "refusal";
  else if (k === "model_unavailable" || (status != null && status >= 500) || status === 404 || /overloaded|service unavailable|model.*(does not exist|not found)|er utilgjengelig/i.test(low)) kind = "unavailable";
  else if (/failed to fetch|network|econn|dns|connection (reset|refused|closed)|error sending request|tcp|nettverksfeil/i.test(low)) kind = "network";
  else if (/azure endpoint og deployment|unsupported provider|decrypt|ai_config_encryption_key|ingen aktiv ai|ikke satt opp riktig/i.test(low)) kind = "config";
  else kind = "other";
  return { kind, systemic: SYSTEMIC.has(kind), httpStatus: status, provider, message: aiFailureMessage(kind, provider, status) };
}

/** Er en lagret feiltekst på fakturaen en AI-feil (ikke en dokumentfeil)? */
export function isAiFailureText(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.replace(/^Forsøk \d+\/\d+:\s*/, "").startsWith(AI_FAILURE_PREFIX);
}

export interface UsageLogRow { created_at: string; success: boolean; error_message: string | null }

/** Siste kall feilet systemisk (nøkkel/kvote/nede/nettverk/oppsett)? Da prøves tjenesten først med en gratis sjekk. */
export function lastCallFailedSystemically(rows: readonly UsageLogRow[]): AiFailure | null {
  const last = rows[0];
  if (!last || last.success) return null;
  const f = classifyAiFailure(last.error_message ?? "");
  return f.systemic ? f : null;
}

/** Minste avstand mellom to forhåndssjekker når tjenesten feiler (hindrer støy i bruksloggen). */
export const PROBE_INTERVAL_MS = 30 * 60 * 1000;
/** Høyst én varsel-e-post per døgn for samme feiltype. */
export const ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * E-postvarsel når lesingen har feilet systemisk to ganger på rad (nyeste først i `rows`),
 * og det ikke er sendt varsel for samme feiltype siste døgn.
 */
export function shouldSendReadingAlert(
  rows: readonly UsageLogRow[], lastAlert: { created_at: string; kind: string | null } | null, nowMs: number,
): AiFailure | null {
  if (rows.length < 2) return null;
  const a = rows[0], b = rows[1];
  if (a.success || b.success) return null;
  const fa = classifyAiFailure(a.error_message ?? "");
  const fb = classifyAiFailure(b.error_message ?? "");
  if (!fa.systemic || !fb.systemic) return null;
  if (lastAlert && lastAlert.kind === fa.kind) {
    const t = Date.parse(lastAlert.created_at);
    if (Number.isFinite(t) && nowMs - t < ALERT_INTERVAL_MS) return null;
  }
  return fa;
}
