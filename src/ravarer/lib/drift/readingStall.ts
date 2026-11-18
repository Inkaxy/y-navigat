// Stillstand og feilrate for fakturalesingen. Samme terskler som serverens rm_reading_stall_check (20261125).
export const STALL_HOURS = 24;
export const FAIL_RATE_PCT = 30;
export const FAIL_RATE_MIN_ATTEMPTS = 5;

export interface StallInput {
  /** Siste ferdig leste faktura (null = ingen kjent). */
  lastOkAt: string | null;
  /** Fakturaer i lesekøen (null = ukjent). */
  pending: number | null;
  /** Lesinger siste døgn: ferdig + feilet (null = ukjent). */
  attempts24h: number | null;
  failed24h: number | null;
}
export type StallState =
  | { kind: "ukjent" }
  | { kind: "ok" }
  | { kind: "stillstand"; hours: number | null }
  | { kind: "feilrate"; pct: number };

/** Stillstand vinner over feilrate. Ukjente tall gir aldri «ok». */
export function readingStall(i: StallInput, now = Date.now()): StallState {
  if (i.pending == null || i.attempts24h == null || i.failed24h == null) return { kind: "ukjent" };
  const last = i.lastOkAt ? Date.parse(i.lastOkAt) : NaN;
  const hours = Number.isFinite(last) ? Math.floor((now - last) / 3_600_000) : null;
  if (i.pending > 0 && (hours == null || hours >= STALL_HOURS)) return { kind: "stillstand", hours };
  if (i.attempts24h >= FAIL_RATE_MIN_ATTEMPTS && i.failed24h * 100 >= FAIL_RATE_PCT * i.attempts24h)
    return { kind: "feilrate", pct: Math.round((i.failed24h * 1000) / i.attempts24h) / 10 };
  return { kind: "ok" };
}

/** Feiltype fra lagret feiltekst: første del før «:» eller kjente nøkkelord. Tom = «ukjent». */
export function errorType(message: string | null): string {
  const m = (message ?? "").trim();
  if (!m) return "ukjent";
  const lower = m.toLowerCase();
  if (/(401|403|api.?key|nøkkel|unauthorized|invalid_api_key)/.test(lower)) return "AI-nøkkel avvist";
  if (/(429|quota|kvote|rate.?limit)/.test(lower)) return "Kvote/for mange kall";
  if (/(timeout|tidsavbrudd|timed out)/.test(lower)) return "Tidsavbrudd";
  if (/(pdf|dokument|document)/.test(lower)) return "Dokumentet kunne ikke leses";
  if (/(sum|regne|mismatch)/.test(lower)) return "Summen stemmer ikke";
  const head = m.split(":")[0].trim();
  return head.length > 0 && head.length <= 40 ? head : "Annen feil";
}

export function errorsByType(rows: readonly { line_extraction_error: string | null }[]): { type: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) { const t = errorType(r.line_extraction_error); m.set(t, (m.get(t) ?? 0) + 1); }
  return [...m].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, "nb"));
}
