import { supabase } from "@/integrations/supabase/client";

/**
 * Returnerer ISO-timestamp for siste passering av 00:00 Europe/Oslo.
 * Trekker timer/min/sek som har gått i Oslo siden midnatt rett fra Date.now().
 * Robust mot DST bortsett fra ±1 t på de to skifte-morgenene per år.
 */
export function osloDayStartIso(): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const elapsedMs = (n("hour") * 3600 + n("minute") * 60 + n("second")) * 1000;
  return new Date(Date.now() - elapsedMs).toISOString();
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(n);
}

export interface TerminalRow {
  id: string;
  terminal_code: string;
  display_name: string;
  status: string;
  legal_entity_id: string;
}

export interface OpenSessionRow {
  id: string;
  terminal_id: string;
  session_number: number | null;
  opened_at: string;
  operator_display_name: string | null;
}

export interface TodayTxnRow {
  terminal_id: string;
  transaction_type: "sale" | "return" | "correction" | "training";
  total_incl_mva: number;
}

export interface LatestZRow {
  terminal_id: string;
  z_number: number;
  closed_at: string;
}

export interface JournalChainResult {
  is_valid: boolean;
  broken_at_id: number | null;
  total_events: number;
}

export interface TerminalAgg {
  gross_net: number;
  sale_count: number;
}

/**
 * Aggregerer dagens omsetning per terminal og totalt.
 *
 * KONTRAKT (avtalt med spec):
 *   - SUM(total_incl_mva) hvor is_training=false. Filteret på is_training
 *     gjøres allerede i SQL-spørringen (se fetchTodayTransactions).
 *   - Retur og korreksjon lagres med speilet (negativt) total_incl_mva i DB.
 *     Vi summerer rå-verdien direkte — INGEN egen fortegn-logikk her.
 *     Negative rader trekker dermed automatisk fra brutto.
 *   - sale_count teller kun rader hvor transaction_type='sale'
 *     (retur/korreksjon skal ikke inngå i "antall salg i dag").
 */
export function aggregateToday(rows: TodayTxnRow[]): {
  total: TerminalAgg;
  perTerminal: Map<string, TerminalAgg>;
} {
  const perTerminal = new Map<string, TerminalAgg>();
  let totalGross = 0;
  let totalSales = 0;
  for (const r of rows) {
    const amount = Number(r.total_incl_mva) || 0;
    totalGross += amount;
    const isSale = r.transaction_type === "sale";
    if (isSale) totalSales += 1;
    const cur = perTerminal.get(r.terminal_id) ?? { gross_net: 0, sale_count: 0 };
    cur.gross_net += amount;
    if (isSale) cur.sale_count += 1;
    perTerminal.set(r.terminal_id, cur);
  }
  return {
    total: { gross_net: totalGross, sale_count: totalSales },
    perTerminal,
  };
}

export async function fetchTerminals(): Promise<TerminalRow[]> {
  const { data, error } = await supabase
    .from("pos_terminals")
    .select("id, terminal_code, display_name, status, legal_entity_id")
    .order("terminal_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TerminalRow[];
}

export async function fetchOpenSessions(): Promise<OpenSessionRow[]> {
  const { data, error } = await supabase
    .from("pos_sessions")
    .select("id, terminal_id, session_number, opened_at, pos_operators(display_name)")
    .eq("status", "open");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    terminal_id: r.terminal_id,
    session_number: r.session_number,
    opened_at: r.opened_at,
    operator_display_name: r.pos_operators?.display_name ?? null,
  }));
}

export async function fetchTodayTransactions(): Promise<TodayTxnRow[]> {
  const dayStart = osloDayStartIso();
  const { data, error } = await supabase
    .from("pos_transactions")
    .select("terminal_id, transaction_type, total_incl_mva")
    .eq("is_training", false)
    .gte("created_at", dayStart);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    terminal_id: r.terminal_id,
    transaction_type: r.transaction_type,
    total_incl_mva: Number(r.total_incl_mva) || 0,
  }));
}

export async function fetchLatestZ(): Promise<Map<string, LatestZRow>> {
  const { data, error } = await supabase
    .from("pos_z_reports")
    .select("terminal_id, z_number, closed_at")
    .order("z_number", { ascending: false });
  if (error) throw error;
  const map = new Map<string, LatestZRow>();
  for (const row of (data ?? []) as LatestZRow[]) {
    if (!map.has(row.terminal_id)) {
      map.set(row.terminal_id, {
        terminal_id: row.terminal_id,
        z_number: Number(row.z_number),
        closed_at: row.closed_at,
      });
    }
  }
  return map;
}

/**
 * Kaller RPC pos_verify_journal_chain(p_terminal_id).
 * RPC returnerer TABLE(is_valid bool, broken_at_id bigint, total_events bigint)
 * — Supabase serialiserer dette som en array med ett element. Vi plukker [0].
 */
export async function verifyJournalChain(terminalId: string): Promise<JournalChainResult> {
  const { data, error } = await supabase.rpc("pos_verify_journal_chain", {
    p_terminal_id: terminalId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { is_valid: false, broken_at_id: null, total_events: 0 };
  return {
    is_valid: !!row.is_valid,
    broken_at_id: row.broken_at_id != null ? Number(row.broken_at_id) : null,
    total_events: Number(row.total_events ?? 0),
  };
}
