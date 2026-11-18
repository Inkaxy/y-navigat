// Husker databaseobjekter som ikke finnes ennå (PENDING-SQL ikke kjørt), slik at appen ikke spør på nytt ved hver
// sidevisning (hundrevis av 404/400 i døgnet). Bare for lesing: markører (rm_cap_*) og GET mot tabell/kolonne.
// Skrivekall huskes aldri. Etter MISSING_TTL_MS spørres det igjen, så en kjørt SQL-fil oppdages innen en time.
export const MISSING_TTL_MS = 60 * 60_000;
const PREFIX = "nbhub:mangler:";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | null => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

/** Nøkkel for et lesekall: rpc-navn for markører, «tabell?select=kolonner» for GET. null = huskes ikke. */
export function missingKey(path: string, method: string): string | null {
  if (method === "POST" && /^rpc\/rm_cap_[a-z0-9_]+$/.test(path)) return path;
  if (method !== "GET") return null;
  const [table, query = ""] = path.split("?");
  const select = new URLSearchParams(query).get("select");
  return `${table}?select=${select ?? "*"}`;
}

export function isKnownMissing(key: string, now = Date.now(), s: Store | null = store()): boolean {
  if (!s) return false;
  const raw = s.getItem(PREFIX + key);
  const at = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(at)) return false;
  if (now - at >= MISSING_TTL_MS || at > now) { s.removeItem(PREFIX + key); return false; }
  return true;
}

export function rememberMissing(key: string, now = Date.now(), s: Store | null = store()): void {
  try { s?.setItem(PREFIX + key, String(now)); } catch { /* full lagring: spør bare igjen neste gang */ }
}

export function forgetMissing(key: string, s: Store | null = store()): void {
  try { s?.removeItem(PREFIX + key); } catch { /* ingenting å rydde */ }
}
