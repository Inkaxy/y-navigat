// Shared Tripletex API client.
// - getSessionToken(supabase, legalEntityId): cached session token (renews < 30 min left)
// - authHeader(token): "Basic base64('0:'+token)"
// - baseUrl(): TRIPLETEX_BASE_URL env, default https://tripletex.no (test env: https://api-test.tripletex.tech)
// - tripletexFetch(path, opts): retry with backoff on 429/5xx, throws TripletexError with parsed validation messages
import { decryptToken, createSessionForMode } from "./tripletex-crypto.ts";

export function baseUrl(): string {
  return (Deno.env.get("TRIPLETEX_BASE_URL") || "https://tripletex.no").replace(/\/+$/, "");
}

export function authHeader(sessionToken: string): string {
  return "Basic " + btoa(`0:${sessionToken}`);
}

export class TripletexError extends Error {
  status: number;
  bodyText: string;
  validationMessages: string[];
  constructor(status: number, bodyText: string, validationMessages: string[]) {
    const summary = validationMessages.length
      ? validationMessages.join("; ")
      : bodyText.slice(0, 400);
    super(`Tripletex ${status}: ${summary}`);
    this.status = status;
    this.bodyText = bodyText;
    this.validationMessages = validationMessages;
  }
}

function parseValidationMessages(text: string): string[] {
  try {
    const j = JSON.parse(text);
    const msgs: string[] = [];
    const push = (m: any) => {
      if (!m) return;
      if (typeof m === "string") msgs.push(m);
      else if (m.message) msgs.push(String(m.message));
    };
    if (j?.message) msgs.push(String(j.message));
    if (Array.isArray(j?.validationMessages)) j.validationMessages.forEach(push);
    if (Array.isArray(j?.developerMessage?.validationMessages)) j.developerMessage.validationMessages.forEach(push);
    if (j?.developerMessage?.message) msgs.push(String(j.developerMessage.message));
    return msgs;
  } catch {
    return [];
  }
}

export async function getSessionToken(
  supabase: any,
  legalEntityId: string,
  forceNew = false,
): Promise<string> {
  const { data: row, error } = await supabase
    .from("tripletex_credentials")
    .select("*")
    .eq("legal_entity_id", legalEntityId)
    .maybeSingle();
  if (error) throw error;
  if (!row || !row.employee_token_encrypted) {
    throw new Error("Tripletex ikke konfigurert for dette selskapet");
  }
  const now = Date.now();
  const expiresAt = row.session_expires_at ? new Date(row.session_expires_at).getTime() : 0;
  if (!forceNew && row.session_token && expiresAt - now > 30 * 60 * 1000) {
    return row.session_token as string;
  }
  const employeeToken = await decryptToken(row.employee_token_encrypted);
  const consumerToken = row.consumer_token_encrypted
    ? await decryptToken(row.consumer_token_encrypted)
    : undefined;
  const session = await createSessionForMode(row.mode ?? "standard", consumerToken, employeeToken);
  const expiresAtIso = session.expirationDate.includes("T")
    ? new Date(session.expirationDate).toISOString()
    : new Date(`${session.expirationDate}T23:59:59Z`).toISOString();

  await supabase
    .from("tripletex_credentials")
    .update({ session_token: session.token, session_expires_at: expiresAtIso })
    .eq("legal_entity_id", legalEntityId);
  return session.token;
}

interface FetchOpts {
  method?: string;
  sessionToken: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  maxRetries?: number;
}

export async function tripletexFetch(path: string, opts: FetchOpts): Promise<any> {
  const url = new URL(baseUrl() + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const method = opts.method || "GET";
  const headers: Record<string, string> = {
    Authorization: authHeader(opts.sessionToken),
    Accept: "application/json",
  };
  let bodyText: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyText = JSON.stringify(opts.body);
  }
  const maxRetries = opts.maxRetries ?? 3;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url.toString(), { method, headers, body: bodyText });
    const text = await res.text();
    if (res.ok) {
      if (!text) return {};
      try { return JSON.parse(text); } catch { return { raw: text }; }
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxRetries) {
      throw new TripletexError(res.status, text, parseValidationMessages(text));
    }
    const wait = 500 * Math.pow(2, attempt) + Math.random() * 200;
    await new Promise((r) => setTimeout(r, wait));
    lastErr = new Error(`Tripletex ${res.status} — retrying`);
  }
  throw lastErr ?? new Error("Tripletex fetch failed");
}
