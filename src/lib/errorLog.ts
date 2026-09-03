/**
 * Enkel, sentral feillogging for NBHub.
 *
 * Feil logges strukturert til `console.error` OG persisteres best-effort i den
 * eksisterende `bug_reports`-tabellen slik at vi kan slå dem opp i admin
 * (Helsesenter → «Automatisk fangede feil») uten SQL. Feillogging skal ALDRI
 * kaste eller blokkere render.
 */
import { supabase } from "@/integrations/supabase/client";

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

const stackOf = (error: unknown): string | null =>
  error instanceof Error && error.stack ? error.stack : null;

/** message+path → siste tidspunkt vi skrev til bug_reports. */
const lastPersisted = new Map<string, number>();
const DEDUPE_MS = 60_000;

/**
 * Skriver feilen til `bug_reports` — fire-and-forget, aldri kastende.
 * `category` må følge tabellens CHECK-liste, derfor `other`; at det er en
 * automatisk fanget feil markeres med `[auto]`-prefiks i tittel og
 * `kind: "auto_error"` i `console_errors`.
 */
export function persistAppError(
  error: unknown,
  context: AppErrorContext & { errorId: string },
): void {
  try {
    if (typeof window === "undefined") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const message = messageOf(error);
    const path = window.location?.pathname ?? "";
    const key = `${message}|${path}`;
    const now = Date.now();
    const prev = lastPersisted.get(key);
    if (prev && now - prev < DEDUPE_MS) return;
    lastPersisted.set(key, now);

    const stack = stackOf(error);
    const componentStack =
      typeof context.details?.componentStack === "string"
        ? (context.details.componentStack as string)
        : null;

    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user ?? null;
        const payload = {
          title: `[auto] ${context.errorId} — ${message.slice(0, 120)}`,
          description: [message, stack, componentStack].filter(Boolean).join("\n\n"),
          severity: "high",
          category: "other",
          source_app: "nbhub",
          source_url: window.location.href,
          user_agent: navigator.userAgent,
          screen_size: `${window.innerWidth}x${window.innerHeight}`,
          console_errors: {
            kind: "auto_error",
            errorId: context.errorId,
            scope: context.scope,
            path,
            at: new Date().toISOString(),
            message,
            stack,
            componentStack,
            app_version: import.meta.env?.VITE_APP_VERSION ?? null,
          },
          reported_by_user_id: user?.id ?? null,
          reporter_email: user?.email ?? null,
          reporter_display_name:
            (user?.user_metadata?.display_name as string | undefined) ?? user?.email ?? null,
        };
        const { error: insErr } = await supabase.from("bug_reports").insert(payload as never);
        if (insErr) {
          // eslint-disable-next-line no-console
          console.warn("[nbhub:error] kunne ikke lagre feil", insErr.message);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[nbhub:error] kunne ikke lagre feil", e);
      }
    })();
  } catch {
    /* feillogging skal aldri kaste */
  }
}

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
  persistAppError(error, { ...context, errorId });
  return errorId;
}

let globalHandlersInstalled = false;

/** Fanger uhåndterte feil og promise-avvisninger én gang per side-innlasting. */
export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled || typeof window === "undefined") return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    logAppError(event.error ?? event.message, {
      scope: "window",
      details: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    logAppError(event.reason, { scope: "promise" });
  });
}
