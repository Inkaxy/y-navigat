/**
 * «Alle priser» (fase a1, bare lesing): alle prisrader for én råvare siden en dato,
 * eldste først, med endring mot forrige sammenlignbare pris og avviksmerke mot
 * medianen i perioden. Bare rader som `historyKind` regner som «gyldig» er
 * sammenlignbare; resten vises som hendelser uten Δ og uten merke.
 */
import { historyKind, HISTORY_KIND_LABEL, type HistoryKind, type TimelineHistoryRow } from "./priceTimeline";

/** Færre gyldige priser enn dette i perioden gir ingen median og ingen avviksmerker. */
export const MIN_PRICES_FOR_MEDIAN = 3;

export interface AllPricesRow {
  row: TimelineHistoryRow;
  kind: HistoryKind;
  /** Norsk etikett når raden ikke er en ordinær pris (null for «gyldig»). */
  kindLabel: string | null;
  /** Endring i prosent mot forrige gyldige pris (også før perioden). Null = ingen sammenligning. */
  changePct: number | null;
  /** Avviker fra periodens median med mer enn grensen. Null = kan ikke avgjøres. */
  deviation: boolean | null;
  /** Prosentavstand fra medianen (null når ukjent). */
  deviationPct: number | null;
}

export interface AllPricesResult {
  rows: AllPricesRow[];
  median: number | null;
  validCount: number;
  /** Grensen som ble brukt (null = ukjent, ingen merker). */
  thresholdPct: number | null;
}

/** Stabil rekkefølge: dato, registreringstid, id — eldste først. */
export function compareOldestFirst(a: TimelineHistoryRow, b: TimelineHistoryRow): number {
  if (a.effective_date !== b.effective_date) return a.effective_date < b.effective_date ? -1 : 1;
  const ca = a.createdAt ?? "";
  const cb = b.createdAt ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function changePct(prev: number | null, cur: number): number | null {
  if (prev == null || !Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur)) return null;
  return ((cur - prev) / prev) * 100;
}

/** Standard «Siden»: samme dato 12 måneder tilbake (Oslo-dato inn, ISO-dato ut). */
export function defaultSince(todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const year = y - 1;
  // 29. februar i et ikke-skuddår blir 28. februar.
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function buildAllPrices(
  history: readonly TimelineHistoryRow[],
  opts: { since: string | null; currentUnit: string | null; thresholdPct: number | null },
): AllPricesResult {
  const sorted = [...history].sort(compareOldestFirst);
  let prevValid: number | null = null;
  const all = sorted.map((row) => {
    const kind = historyKind(row, opts.currentUnit);
    const price = Number(row.price);
    const ch = kind === "gyldig" ? changePct(prevValid, price) : null;
    if (kind === "gyldig") prevValid = price;
    return { row, kind, changePct: ch };
  });
  const inPeriod = all.filter((r) => !opts.since || r.row.effective_date >= opts.since);
  const valid = inPeriod.filter((r) => r.kind === "gyldig").map((r) => Number(r.row.price));
  const med = valid.length >= MIN_PRICES_FOR_MEDIAN ? median(valid) : null;
  const limit = opts.thresholdPct != null && Number.isFinite(opts.thresholdPct) && opts.thresholdPct >= 0 ? opts.thresholdPct : null;
  const rows: AllPricesRow[] = inPeriod.map((r) => {
    let deviation: boolean | null = null;
    let deviationPct: number | null = null;
    if (r.kind === "gyldig" && med != null && med > 0) {
      deviationPct = (Math.abs(Number(r.row.price) - med) / med) * 100;
      deviation = limit == null ? null : deviationPct > limit;
    }
    return { ...r, kindLabel: r.kind === "gyldig" ? null : HISTORY_KIND_LABEL[r.kind], deviation, deviationPct };
  });
  return { rows, median: med, validCount: valid.length, thresholdPct: limit };
}

/** Hvem eller hva som registrerte prisen. Rader uten bruker er registrert av systemet. */
export function registeredByLabel(row: Pick<TimelineHistoryRow, "source" | "createdBy">, names: ReadonlyMap<string, string> | null): string {
  const who = row.createdBy ? names?.get(row.createdBy) ?? "Bruker" : null;
  const src = row.source ?? "";
  if (src.startsWith("invoice")) return who ? `Faktura · ${who}` : "Faktura · automatisk";
  if (src === "recalc") return who ? `Reberegning · ${who}` : "Reberegning";
  if (src === "manual") return who ? `Manuell · ${who}` : "Manuell registrering";
  return who ?? "Ukjent kilde";
}
