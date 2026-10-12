import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parsePriceSafety, PRICE_SAFETY_KEY, safetyGate, UNCHECKED, versionKey, type InvoiceSafety } from "@/fakturaer/lib/priceSafety";
import type { PriceGate } from "@/fakturaer/lib/financialPresentation";

// Høyst fire samtidige kall på tvers av flater (varekort kan spenne mange fakturaer).
export const SAFETY_MAX_CONCURRENT = 4;
let active = 0;
const waiting: { admit: () => void }[] = [];

function abortError(): Error {
  const e = new Error("avbrutt");
  e.name = "AbortError";
  return e;
}
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/** Plass i køen. Avbrutt i kø: fjernes uten å starte; plass frigjøres nøyaktig én gang. */
async function limited<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (active >= SAFETY_MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const entry = { admit: () => { signal?.removeEventListener("abort", onAbort); resolve(); } };
      const onAbort = () => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(abortError());
      };
      waiting.push(entry);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  active++;
  try {
    throwIfAborted(signal);
    return await fn();
  } finally {
    active--;
    waiting.shift()?.admit();
  }
}

/** Kun for tester: gjeldende kø-/aktivtilstand. */
export function __safetyQueueState() { return { active, waiting: waiting.length }; }

/** Lokal frist fra mottak. Serverens tidspunkt kan aldri forlenge den. */
export const SAFETY_MAX_AGE_MS = 60_000;
export const SAFETY_REFETCH_MS = 30_000;
/** Kvittering eldre enn dette ved mottak (serverklokke) regnes som ugyldig. */
const MAX_SERVER_LAG_MS = 120_000;
/** Sidestørrelse godt under serverens radtak; komplettheten bevises med eksakt antall. */
export const SAFETY_ROW_PAGE = 500;

export type RowVersion = { updated_at: string | null; raw_material_id: string | null };
export type SafetyResult = InvoiceSafety & { received_at: number; rows: Map<string, RowVersion> };

/** Alle fakturalinjers radversjon: eksakt antall + keyset på id. Ufullstendig = feil, aldri delvis kart. */
async function fetchAllRowVersions(invoiceId: string, signal?: AbortSignal): Promise<Map<string, RowVersion>> {
  throwIfAborted(signal);
  let countQ = supabase.from("invoice_lines").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId);
  if (signal) countQ = countQ.abortSignal(signal);
  const c = await countQ;
  if (c.error) throw c.error;
  if (typeof c.count !== "number") throw new Error("ukjent_linjeantall");
  const total = c.count;
  const rows = new Map<string, RowVersion>();
  let after: string | null = null;
  while (rows.size < total) {
    throwIfAborted(signal);
    let q = supabase.from("invoice_lines").select("id, updated_at, raw_material_id").eq("invoice_id", invoiceId).order("id", { ascending: true }).limit(SAFETY_ROW_PAGE);
    if (after) q = q.gt("id", after);
    if (signal) q = q.abortSignal(signal);
    const r = await q;
    if (r.error) throw r.error;
    const page = r.data ?? [];
    if (page.length === 0) break;
    for (const row of page) {
      if (rows.has(row.id)) throw new Error("dupliserte_linjer");
      rows.set(row.id, { updated_at: row.updated_at, raw_material_id: row.raw_material_id });
    }
    after = page[page.length - 1].id;
  }
  if (rows.size !== total) throw new Error("ufullstendige_linjer");
  return rows;
}

/**
 * Kvittering + faktisk radversjon for fakturaens linjer, hentet etter kvitteringen.
 * Selskapet tas fra den autoriserte fakturaraden, aldri fra kvitteringen selv.
 */
export async function fetchInvoicePriceSafety(invoiceId: string, signal?: AbortSignal): Promise<SafetyResult> {
  return limited(async () => {
    let invQ = supabase.from("invoices").select("id, legal_entity_id").eq("id", invoiceId);
    if (signal) invQ = invQ.abortSignal(signal);
    const inv = await invQ.maybeSingle();
    if (inv.error) throw inv.error;
    if (!inv.data) throw new Error("ukjent_faktura");
    throwIfAborted(signal);
    let rpc = supabase.rpc("rm_invoice_line_price_safety", { p_invoice_id: invoiceId });
    if (signal) rpc = rpc.abortSignal(signal);
    const { data, error } = await rpc;
    if (error) throw error;
    const parsed = parsePriceSafety(data, invoiceId, inv.data.legal_entity_id);
    if (!parsed) throw new Error("ugyldig_prisstatus");
    const rows = await fetchAllRowVersions(invoiceId, signal);
    throwIfAborted(signal);
    const received_at = Date.now();
    if (Date.parse(parsed.checked_at) < received_at - MAX_SERVER_LAG_MS) throw new Error("utdatert_prisstatus");
    return { ...parsed, received_at, rows };
  }, signal);
}

export type SafetyLineRef = { id: string; invoice_id: string; updated_at?: string | null; raw_material_id?: string | null };
export type GateFor = (line: SafetyLineRef) => PriceGate;

/** Fersk = vellykket, ingen henting i gang, og innenfor lokal frist fra mottak. */
export function isFresh(q: { isSuccess: boolean; isFetching: boolean; isError: boolean; data?: { received_at: number } }, now: number): boolean {
  return q.isSuccess && !q.isFetching && !q.isError && !!q.data && now - q.data.received_at <= SAFETY_MAX_AGE_MS && now >= q.data.received_at - 1000;
}

/** Binder kvitteringen til faktisk rad (fersk henting) og evt. kallerens egen rad. Alt må stemme. */
export function gateWithRows(data: SafetyResult | undefined, fresh: boolean, line: SafetyLineRef, expectRawMaterialId?: string | null): PriceGate {
  if (!fresh || !data || data.invoice_id !== line.invoice_id) return UNCHECKED;
  const entry = data.lines.get(line.id);
  const row = data.rows.get(line.id);
  if (!entry || !row) return UNCHECKED;
  if (line.updated_at !== undefined && versionKey(line.updated_at) !== versionKey(row.updated_at)) return UNCHECKED;
  if (line.raw_material_id !== undefined && line.raw_material_id !== row.raw_material_id) return UNCHECKED;
  const g = safetyGate(entry, true, { updated_at: row.updated_at, raw_material_id: row.raw_material_id });
  if (g.ok && expectRawMaterialId !== undefined && g.safety.raw_material_id !== expectRawMaterialId) return UNCHECKED;
  return g;
}

/**
 * Prisstatus for én eller flere fakturaer. Bare fersk, feilfri status brukes: lasting, feil,
 * oppdatering (også bakgrunnshenting), utløpt frist eller `pending` gir «Prisgrunnlag ikke kontrollert».
 * `rawMaterialId` (varekort) avviser kvitteringer for en annen råvare.
 */
export function useInvoicePriceSafety(invoiceIds: readonly (string | null | undefined)[], opts?: { pending?: boolean; rawMaterialId?: string | null; active?: boolean }) {
  const ids = [...new Set(invoiceIds.filter((x): x is string => !!x))].sort();
  const qs = useQueries({
    queries: ids.map((id) => ({
      queryKey: [PRICE_SAFETY_KEY, id] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchInvoicePriceSafety(id, signal),
      // Skjult/inaktiv eier: ingen henting eller polling for denne observatøren. Andre synlige
      // observatører av samme nøkkel fortsetter uforstyrret (ingen global cancelQueries).
      enabled: opts?.active !== false,
      staleTime: 15_000,
      refetchInterval: SAFETY_REFETCH_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      retry: (n: number, err: unknown) => n < 1 && !(err instanceof Error && err.name === "AbortError"),
    })),
  });
  // Ny gjengivelse når en kvittering passerer fristen, slik at utløpt status aldri blir stående som godkjent.
  const [now, setNow] = useState(() => Date.now());
  // Neste FREMTIDIGE frist; allerede utløpte kvitteringer skal ikke blokkere planlegging av senere frister.
  const nowMs = Date.now();
  const nextExpiry = Math.min(...qs.map((q) => { const e = q.data ? q.data.received_at + SAFETY_MAX_AGE_MS + 1 : Infinity; return e > nowMs ? e : Infinity; }));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(t);
  }, [nextExpiry]);
  const clock = Math.max(now, Date.now());
  const byId = new Map<string, (typeof qs)[number]>();
  ids.forEach((id, i) => byId.set(id, qs[i]));
  const gateFor: GateFor = (line) => {
    if (opts?.pending || opts?.active === false) return UNCHECKED;
    const q = byId.get(line.invoice_id);
    if (!q) return UNCHECKED;
    return gateWithRows(q.data, isFresh(q, clock), line, opts?.rawMaterialId);
  };
  const allFresh = ids.length > 0 && qs.every((q) => isFresh(q, clock));
  const anyError = qs.some((q) => q.isError);
  const refetch = () => { qs.forEach((q) => void q.refetch()); };
  return { gateFor, allFresh, anyError, refetch, loading: qs.some((q) => q.isLoading) };
}
