/**
 * Kall mot databaseobjekter som ligger i en PENDING-SQL-fil og derfor ikke finnes i den genererte
 * typefilen ennå. Svarene er alltid `unknown` og må leses av en streng parser. 404 / manglende kolonne
 * = «ikke kjørt ennå» (`missing`), slik at nye flater kan vise hva som venter i stedet for å feile.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PendingResult<T = unknown> =
  | { kind: "ok"; data: T }
  | { kind: "missing" }
  | { kind: "denied" }
  /** Ukjent utfall: transportfeil, 5xx eller uleselig svar. Aldri tolket som suksess eller avvisning. */
  | { kind: "error"; status: number | null; code: string | null };

/** Feilkoder som betyr at objektet eller kolonnen ikke finnes (SQL-en er ikke kjørt). */
const MISSING_CODES = new Set(["PGRST202", "PGRST205", "PGRST204", "42883", "42P01", "42703"]);

export function classifyPending(status: number, body: unknown): PendingResult {
  const code = body && typeof body === "object" && !Array.isArray(body) && typeof (body as { code?: unknown }).code === "string"
    ? (body as { code: string }).code : null;
  if (status >= 200 && status < 300) return { kind: "ok", data: body };
  if (status === 404 || (code && MISSING_CODES.has(code))) return { kind: "missing" };
  if (status === 401 || status === 403 || code === "42501") return { kind: "denied" };
  return { kind: "error", status, code };
}

async function headers(extra?: Record<string, string>): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra };
}

async function send(path: string, init: RequestInit & { extraHeaders?: Record<string, string> }): Promise<PendingResult> {
  const h = await headers(init.extraHeaders);
  if (!h) return { kind: "denied" };
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: h });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { return res.ok ? { kind: "error", status: res.status, code: "uleselig" } : classifyPending(res.status, null); }
    }
    return classifyPending(res.status, body);
  } catch {
    return { kind: "error", status: null, code: null };
  }
}

export function callPendingRpc(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<PendingResult> {
  return send(`rpc/${name}`, { method: "POST", body: JSON.stringify(args), signal });
}

/** GET mot en tabell/kolonne som kan mangle. `query` er PostgREST-spørringen uten «?». */
export function pendingSelect(table: string, query: string, signal?: AbortSignal): Promise<PendingResult> {
  return send(`${table}?${query}`, { method: "GET", signal });
}

/** PATCH med filter; svarer med de oppdaterte radene (tom liste = ingen rad traff). */
export function pendingPatch(table: string, filter: string, body: Record<string, unknown>): Promise<PendingResult> {
  return send(`${table}?${filter}`, { method: "PATCH", body: JSON.stringify(body), extraHeaders: { Prefer: "return=representation" } });
}

export function pendingInsert(table: string, body: Record<string, unknown>): Promise<PendingResult> {
  return send(table, { method: "POST", body: JSON.stringify(body), extraHeaders: { Prefer: "return=representation" } });
}

export function pendingDelete(table: string, filter: string): Promise<PendingResult> {
  return send(`${table}?${filter}`, { method: "DELETE", extraHeaders: { Prefer: "return=representation" } });
}

export type CapabilityName =
  | "rm_cap_beslutninger_v1" | "rm_cap_prislinje_v1" | "rm_cap_automatikk_v1"
  | "varer_cap_handelsvarer_v1" | "varer_cap_prisgrunnlag_v1" | "rm_cap_fra_faktura_v1";
/** Venter-tekster per PENDING-fil (vises i stedet for knappene). */
export const CAPABILITY_FILE: Record<CapabilityName, string> = {
  rm_cap_beslutninger_v1: "Beslutninger – angre",
  rm_cap_prislinje_v1: "Prislinje",
  rm_cap_automatikk_v1: "Automatikk",
  varer_cap_handelsvarer_v1: "Handelsvarer",
  varer_cap_prisgrunnlag_v1: "Prisgrunnlag",
  rm_cap_fra_faktura_v1: "Fra faktura",
};

/**
 * Er PENDING-filen kjørt? `true` = ja, `false` = ikke kjørt ennå, `null` = ukjent (lasting/feil).
 * Ukjent viser aldri knappene.
 */
export function useCapability(name: CapabilityName): boolean | null {
  const q = useQuery({
    queryKey: ["pending-capability", name],
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const r = await callPendingRpc(name, {});
      if (r.kind === "ok") return r.data === true;
      if (r.kind === "missing") return false;
      throw new Error("Kunne ikke kontrollere databaseendringen.");
    },
  });
  return q.isSuccess ? q.data : null;
}

export const newOpId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); });
