// AES-GCM encryption helpers for Microsoft Graph OAuth tokens.
// Key source: MICROSOFT_GRAPH_ENCRYPTION_KEY env (any string; SHA-256 derives 32 bytes).
// Mirror av tripletex-crypto.ts — egen nøkkel for defense-in-depth.

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("MICROSOFT_GRAPH_ENCRYPTION_KEY");
  if (!raw) throw new Error("MICROSOFT_GRAPH_ENCRYPTION_KEY is not configured");
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

const GRAPH_SCOPES = [
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/User.Read",
  "offline_access",
];

export function buildAuthorizationUrl(opts: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", GRAPH_SCOPES.join(" "));
  url.searchParams.set("state", opts.state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCodeForToken(opts: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
    scope: GRAPH_SCOPES.join(" "),
  });
  const res = await fetch(`https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Microsoft token exchange failed (${res.status}): ${text}`);
  return JSON.parse(text) as TokenResponse;
}

export async function refreshAccessToken(opts: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: "refresh_token",
    scope: GRAPH_SCOPES.join(" "),
  });
  const res = await fetch(`https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Microsoft refresh failed (${res.status}): ${text}`);
  return JSON.parse(text) as TokenResponse;
}

export async function fetchUserProfile(accessToken: string): Promise<{ mail: string; userPrincipalName: string; displayName: string }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Graph /me failed (${res.status}): ${text}`);
  return JSON.parse(text);
}
