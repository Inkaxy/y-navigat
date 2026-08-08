// AES-GCM encryption helpers for Tripletex tokens.
// Key source: TRIPLETEX_ENCRYPTION_KEY env (any string; we derive 32 bytes via SHA-256).

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("TRIPLETEX_ENCRYPTION_KEY");
  if (!raw) throw new Error("TRIPLETEX_ENCRYPTION_KEY is not configured");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptToken(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  return `v1:${b64(iv)}:${b64(cipher)}`;
}

export async function decryptToken(payload: string): Promise<string> {
  const [v, ivB64, cipherB64] = payload.split(":");
  if (v !== "v1") throw new Error("Unsupported token payload version");
  const key = await getKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ivB64) },
    key,
    unb64(cipherB64),
  );
  return new TextDecoder().decode(plain);
}

function sessionBaseUrl(): string {
  return (Deno.env.get("TRIPLETEX_BASE_URL") || "https://tripletex.no").replace(/\/+$/, "");
}

async function requestSession(
  params: Record<string, string>,
  exp: string,
): Promise<{ ok: boolean; status: number; text: string; token?: string; expirationDate?: string }> {
  const url = new URL(sessionBaseUrl() + "/v2/token/session/:create");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("expirationDate", exp);
  const res = await fetch(url.toString(), { method: "PUT" });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };
  try {
    const parsed = JSON.parse(text);
    return {
      ok: true,
      status: res.status,
      text,
      token: parsed?.value?.token,
      expirationDate: parsed?.value?.expirationDate ?? exp,
    };
  } catch {
    return { ok: false, status: res.status, text: `Invalid Tripletex response: ${text}` };
  }
}

/** Calls Tripletex /v2/token/session/:create to validate and return a session token. */
export async function createSessionToken(
  consumerToken: string,
  employeeToken: string,
  expirationDate?: string,
): Promise<{ token: string; expirationDate: string }> {
  const exp = expirationDate ?? new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const r = await requestSession({ consumerToken, employeeToken }, exp);
  if (!r.ok) throw new Error(`Tripletex auth failed (${r.status}): ${r.text}`);
  if (!r.token) throw new Error("Tripletex returned no session token");
  return { token: r.token, expirationDate: r.expirationDate! };
}

/** Tripletex tillater maks 28800 sekunder (8 timer) på en sesjonsnøkkel. */
export const MAX_TTL_SECONDS = 28800;

function translateTripletexError(text: string, status: number): string {
  let msgs: string[] = [];
  try {
    const j = JSON.parse(text);
    if (j?.message) msgs.push(String(j.message));
    if (Array.isArray(j?.validationMessages)) {
      for (const m of j.validationMessages) msgs.push(String(m?.message ?? m));
    }
    if (Array.isArray(j?.developerMessage?.validationMessages)) {
      for (const m of j.developerMessage.validationMessages) msgs.push(String(m?.message ?? m));
    }
    if (j?.developerMessage?.message) msgs.push(String(j.developerMessage.message));
  } catch {
    msgs = [text];
  }
  const joined = msgs.join("; ");
  const lower = joined.toLowerCase();
  if (lower.includes("format")) {
    return "Nøkkelen mangler prefikset — kopier hele nøkkelen inkludert tlxr_";
  }
  if (lower.includes("expired")) {
    return "Tripletex kjenner ikke igjen nøkkelen. Den kan være slettet, utløpt, eller laget i et annet miljø. Lag en ny under Selskap → API-tokens.";
  }
  return `Tripletex auth failed (${status}): ${joined || text.slice(0, 400)}`;
}

/**
 * JWT/API-nøkkel-modus (Selskap → API-tokens, nøkler som starter med tlxr_).
 * Veksler nøkkelen inn via POST /v2/token/session/:createFromRefreshToken.
 * Ett forsøk — ingen fallback-løkke, slik at den ekte feilen fra Tripletex vises.
 */
export async function createSessionFromJwt(
  apiKey: string,
  ttlSeconds = MAX_TTL_SECONDS,
): Promise<{ token: string; expirationDate: string }> {
  const ttl = Math.min(MAX_TTL_SECONDS, Math.max(60, Math.floor(ttlSeconds)));
  const res = await fetch(sessionBaseUrl() + "/v2/token/session/:createFromRefreshToken", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    // Nøkkelen sendes NØYAKTIG som lagret — tlxr_-prefikset er påkrevd.
    body: JSON.stringify({ refreshToken: apiKey, ttlSeconds: ttl }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(translateTripletexError(text, res.status));
  let token: string | undefined;
  try {
    token = JSON.parse(text)?.value?.token;
  } catch {
    throw new Error(`Invalid Tripletex response: ${text.slice(0, 400)}`);
  }
  if (!token) throw new Error("Tripletex returnerte ingen sesjonsnøkkel");
  return { token, expirationDate: new Date(Date.now() + ttl * 1000).toISOString() };
}

/** Velger riktig innloggingsmåte ut fra lagret modus. */
export async function createSessionForMode(
  mode: string,
  consumerToken: string | undefined,
  employeeToken: string,
): Promise<{ token: string; expirationDate: string }> {
  if (mode === "jwt") return createSessionFromJwt(employeeToken);
  return createSessionToken(mode === "private" ? employeeToken : consumerToken!, employeeToken);
}


export function basicAuthHeader(sessionToken: string): string {
  // Tripletex bruker Basic auth med tom user og session token som passord
  return "Basic " + btoa(`0:${sessionToken}`);
}
