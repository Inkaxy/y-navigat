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

/**
 * JWT/API-nøkkel-modus: én nøkkel per selskap (Selskap → API-tokens).
 * Nyere Tripletex-nøkler veksles inn som `refreshToken`; eldre oppsett
 * godtar samme nøkkel som `employeeToken` — derfor fallback-rekkefølge.
 */
export async function createSessionTokenFromApiKey(
  apiKey: string,
  expirationDate?: string,
): Promise<{ token: string; expirationDate: string }> {
  const exp = expirationDate ?? new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const attempts: Record<string, string>[] = [
    { refreshToken: apiKey },
    { employeeToken: apiKey },
    { consumerToken: apiKey, employeeToken: apiKey },
  ];
  let last: Awaited<ReturnType<typeof requestSession>> | null = null;
  for (const params of attempts) {
    last = await requestSession(params, exp);
    if (last.ok && last.token) return { token: last.token, expirationDate: last.expirationDate! };
  }
  throw new Error(`Tripletex auth failed (${last?.status}): ${last?.text}`);
}

/** Velger riktig innloggingsmåte ut fra lagret modus. */
export async function createSessionForMode(
  mode: string,
  consumerToken: string | undefined,
  employeeToken: string,
): Promise<{ token: string; expirationDate: string }> {
  if (mode === "jwt") return createSessionTokenFromApiKey(employeeToken);
  return createSessionToken(mode === "private" ? employeeToken : consumerToken!, employeeToken);
}

export function basicAuthHeader(sessionToken: string): string {
  // Tripletex bruker Basic auth med tom user og session token som passord
  return "Basic " + btoa(`0:${sessionToken}`);
}
