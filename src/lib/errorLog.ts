/**
 * Enkel, sentral feillogging for NBHub.
 *
 * Frontend har foreløpig ingen ekstern observability (Sentry el.l.). Inntil det
 * kobles på logger vi strukturert til `console.error` med en kort feil-ID som
 * kan leses opp av brukeren i support. Alle feilflater (ErrorBoundary, auth,
 * skjemaer) skal bruke denne mekanismen i stedet for å vise rå tekniske
 * feilmeldinger til sluttbruker.
 */

/** Kort, lesbar feil-ID, f.eks. `NBH-M7QK2X-4F9A`. */
export function createErrorId(now: number = Date.now(), random: number = Math.random()): string {
  const time = now.toString(36).toUpperCase().slice(-6);
  const rand = Math.floor(random * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `NBH-${time}-${rand}`;
}

export interface AppErrorContext {
  /** Hvor feilen oppsto, f.eks. `auth:sign-in` eller `boundary:module`. */
  scope: string;
  /** Ferdig generert feil-ID. Lages automatisk hvis den utelates. */
  errorId?: string;
  /** Ekstra, ikke-sensitive detaljer (rute, komponent, o.l.). */
  details?: Record<string, unknown>;
}

const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Ukjent feil";
};

/**
 * Logger en teknisk feil strukturert og returnerer feil-IDen som kan vises
 * til brukeren. Sensitive verdier skal aldri sendes inn i `details`.
 */
export function logAppError(error: unknown, context: AppErrorContext): string {
  const errorId = context.errorId ?? createErrorId();
  // eslint-disable-next-line no-console
  console.error("[nbhub:error]", {
    errorId,
    scope: context.scope,
    message: messageOf(error),
    path: typeof window !== "undefined" ? window.location.pathname : undefined,
    at: new Date().toISOString(),
    ...(context.details ?? {}),
    error,
  });
  return errorId;
}
