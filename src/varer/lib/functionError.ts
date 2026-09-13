/**
 * Felles lesing av feil fra `supabase.functions.invoke`.
 *
 * Ved ikke-2xx gir klienten `data: null` og en `FunctionsHttpError` der
 * `context` er selve `Response`-objektet. Leser man bare `data.error`, mister
 * man hele den strukturerte feilen. Derfor klones responsen og leses som JSON,
 * med strenge grenser på hva vi godtar.
 */

export interface FunctionErrorPayload {
  code?: string;
  message?: string;
  status?: number;
}

const MAX_MESSAGE = 500;
const MAX_CODE = 64;

function pickString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function fromObject(raw: unknown): FunctionErrorPayload {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  return {
    code: pickString(o.code, MAX_CODE),
    message: pickString(o.error, MAX_MESSAGE) ?? pickString(o.message, MAX_MESSAGE),
  };
}

function isResponseLike(value: unknown): value is Response {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Response).clone === "function" &&
    typeof (value as Response).json === "function"
  );
}

/**
 * Henter `code` og `message` fra en mislykket invoke. Tåler at kroppen mangler,
 * ikke er JSON, eller allerede er lest.
 */
export async function readFunctionError(
  fnError: unknown,
  data: unknown,
): Promise<FunctionErrorPayload> {
  const fromData = fromObject(data);
  if (fromData.code || fromData.message) return fromData;

  const context = (fnError as { context?: unknown } | null)?.context;
  if (isResponseLike(context)) {
    const status = typeof context.status === "number" ? context.status : undefined;
    try {
      const body = await context.clone().json();
      const parsed = fromObject(body);
      if (parsed.code || parsed.message) return { ...parsed, status };
    } catch {
      // Kroppen var ikke lesbar JSON — vi faller tilbake til status/meldingen.
    }
    if (status === 401 || status === 403) return { code: "forbidden", status };
    return { status };
  }

  const message = pickString((fnError as { message?: unknown } | null)?.message, MAX_MESSAGE);
  return message ? { message } : {};
}
