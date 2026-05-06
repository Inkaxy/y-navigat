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

/** Calls Tripletex /v2/token/session/:create to validate and return a session token. */
export async function createSessionToken(
  consumerToken: string,
  employeeToken: string,
  expirationDate?: string,
): Promise<{ token: string; expirationDate: string }> {
  const exp = expirationDate ?? new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = new URL("https://tripletex.no/v2/token/session/:create");
  url.searchParams.set("consumerToken", consumerToken);
  url.searchParams.set("employeeToken", employeeToken);
  url.searchParams.set("expirationDate", exp);
  const res = await fetch(url.toString(), { method: "PUT" });
  const text = await res.text();
  if (!res.ok) throw new Error(`Tripletex auth failed (${res.status}): ${text}`);
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Invalid Tripletex response: ${text}`); }
  const token = parsed?.value?.token;
  const expirationDateOut = parsed?.value?.expirationDate ?? exp;
  if (!token) throw new Error("Tripletex returned no session token");
  return { token, expirationDate: expirationDateOut };
}

export function basicAuthHeader(sessionToken: string): string {
  // Tripletex bruker Basic auth med tom user og session token som passord
  return "Basic " + btoa(`0:${sessionToken}`);
}
