/**
 * Klassifisering av svar anon-nøkkelen får fra Supabase.
 *
 * Sikkerhetstestene skal bare godta to utfall:
 *  - «nektet»: Postgres svarer permission denied (SQLSTATE 42501) med HTTP 401/403,
 *    eller PostgREST avviser tokenet før spørringen kjøres (PGRST301/PGRST302, HTTP 401).
 *  - «tom»: spørringen gikk gjennom, men RLS filtrerte bort alt — et EKTE array med 0 rader.
 *
 * Alt annet (nettverksfeil, 400, 404, 500, skjemafeil, `null`/objekt i stedet for
 * array) er et brudd: da vet vi ikke om tabellen faktisk er beskyttet.
 */

export interface AnonResponse {
  data: unknown;
  error: { message?: string | null; code?: string | null; details?: string | null } | null;
  status?: number | null;
}

export type AnonOutcome =
  | { kind: "denied"; code: string; status: number }
  | { kind: "empty" }
  | { kind: "violation"; reason: string };

/** Postgres: insufficient_privilege. Det eneste vi godtar fra databasen selv. */
export const PERMISSION_DENIED_SQLSTATE = "42501";

/**
 * PostgREST-koder som betyr «autentisering mangler/avvist» før spørringen når
 * databasen. Dokumentert som godkjent autentiseringssvar.
 */
export const AUTH_REJECTED_CODES = ["PGRST301", "PGRST302"] as const;

const DENIED_STATUSES = [401, 403];

function describe(status: number | null | undefined, code: string | null | undefined, message?: string | null) {
  return `status=${status ?? "ingen"} kode=${code ?? "ingen"} melding=${message ?? "ingen"}`;
}

export function classifyAnonResult(res: AnonResponse): AnonOutcome {
  const status = typeof res.status === "number" ? res.status : null;

  if (res.error) {
    const code = res.error.code ?? null;
    if (!code) {
      return {
        kind: "violation",
        reason: `Feil uten feilkode — kan være nettverks- eller skjemafeil (${describe(status, code, res.error.message)})`,
      };
    }
    const isDeniedCode =
      code === PERMISSION_DENIED_SQLSTATE ||
      (AUTH_REJECTED_CODES as readonly string[]).includes(code);
    if (!isDeniedCode) {
      return {
        kind: "violation",
        reason: `Uventet feilkode — forventet ${PERMISSION_DENIED_SQLSTATE} eller ${AUTH_REJECTED_CODES.join("/")} (${describe(status, code, res.error.message)})`,
      };
    }
    if (status === null || !DENIED_STATUSES.includes(status)) {
      return {
        kind: "violation",
        reason: `Forventet HTTP 401/403 sammen med ${code} (${describe(status, code, res.error.message)})`,
      };
    }
    return { kind: "denied", code, status };
  }

  if (!Array.isArray(res.data)) {
    return {
      kind: "violation",
      reason: `Suksess uten array — fikk ${res.data === null ? "null" : typeof res.data}. Da vet vi ikke at RLS filtrerte alt.`,
    };
  }
  if (res.data.length !== 0) {
    return { kind: "violation", reason: `Anon fikk ${res.data.length} rader ut` };
  }
  return { kind: "empty" };
}

/**
 * Utfall som krever eksplisitt avvisning (ikke tomt resultat). Brukes på RPC-er
 * som aldri skal kunne kjøres uten innlogging.
 */
export function classifyAnonDeniedOnly(res: AnonResponse): AnonOutcome {
  const outcome = classifyAnonResult(res);
  if (outcome.kind === "empty") {
    return { kind: "violation", reason: "RPC-en svarte uten autentiseringsfeil — den kan kjøres av anon" };
  }
  return outcome;
}

/** Feilmelding som vises i testen når utfallet er et brudd. */
export function anonOutcomeMessage(label: string, outcome: AnonOutcome): string {
  return outcome.kind === "violation" ? `${label}: ${outcome.reason}` : `${label}: ok`;
}
