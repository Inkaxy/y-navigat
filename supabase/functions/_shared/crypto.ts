// Generic AES-GCM helpers driven by an env-provided key name.
// Used by AI provider config (AI_CONFIG_ENCRYPTION_KEY) and any other
// place that needs application-level encryption of a single string.

async function getKey(envName: string): Promise<CryptoKey> {
  const raw = Deno.env.get(envName);
  if (!raw) throw new Error(`${envName} is not configured`);
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

export async function encryptWithKey(plain: string, envName: string): Promise<string> {
  const key = await getKey(envName);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  return `v1:${b64(iv)}:${b64(cipher)}`;
}

export async function decryptWithKey(payload: string, envName: string): Promise<string> {
  const [v, ivB64, cipherB64] = payload.split(":");
  if (v !== "v1") throw new Error("Unsupported payload version");
  const key = await getKey(envName);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ivB64) },
    key,
    unb64(cipherB64),
  );
  return new TextDecoder().decode(plain);
}
