// Forhåndsdefinerte periode-snarveier for periode-velger.
// Datoer returneres som ISO yyyy-mm-dd.

export type PeriodPreset =
  | "ytd"
  | "last_year"
  | "ytd_last_year"
  | "last_30d"
  | "last_90d"
  | "last_12m"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "custom";

export type ComparePreset = "same_period_last_year" | "previous_period" | "custom" | "none";

export interface DateRange {
  start: string;
  end: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function startOfYear(year: number) { return new Date(Date.UTC(year, 0, 1)); }

function endOfMonth(year: number, monthIdx: number) {
  return new Date(Date.UTC(year, monthIdx + 1, 0));
}

export function rangeForPreset(preset: PeriodPreset, today = new Date()): DateRange {
  const y = today.getUTCFullYear();
  const todayIso = iso(today);
  switch (preset) {
    case "ytd":
      return { start: iso(startOfYear(y)), end: todayIso };
    case "last_year":
      return { start: iso(startOfYear(y - 1)), end: iso(endOfMonth(y - 1, 11)) };
    case "ytd_last_year": {
      const lastYearSameDate = new Date(today);
      lastYearSameDate.setUTCFullYear(y - 1);
      return { start: iso(startOfYear(y - 1)), end: iso(lastYearSameDate) };
    }
    case "last_30d": {
      const start = new Date(today); start.setUTCDate(start.getUTCDate() - 29);
      return { start: iso(start), end: todayIso };
    }
    case "last_90d": {
      const start = new Date(today); start.setUTCDate(start.getUTCDate() - 89);
      return { start: iso(start), end: todayIso };
    }
    case "last_12m": {
      const start = new Date(today); start.setUTCMonth(start.getUTCMonth() - 12);
      start.setUTCDate(start.getUTCDate() + 1);
      return { start: iso(start), end: todayIso };
    }
    case "q1": return { start: iso(new Date(Date.UTC(y, 0, 1))), end: iso(endOfMonth(y, 2)) };
    case "q2": return { start: iso(new Date(Date.UTC(y, 3, 1))), end: iso(endOfMonth(y, 5)) };
    case "q3": return { start: iso(new Date(Date.UTC(y, 6, 1))), end: iso(endOfMonth(y, 8)) };
    case "q4": return { start: iso(new Date(Date.UTC(y, 9, 1))), end: iso(endOfMonth(y, 11)) };
    default:
      return { start: iso(startOfYear(y)), end: todayIso };
  }
}

export const PERIOD_PRESET_LABELS: Array<{ value: PeriodPreset; label: string }> = [
  { value: "ytd", label: "Hittil i år" },
  { value: "last_year", label: "Hele i fjor" },
  { value: "ytd_last_year", label: "Hittil i fjor" },
  { value: "last_30d", label: "Siste 30 dager" },
  { value: "last_90d", label: "Siste 90 dager" },
  { value: "last_12m", label: "Siste 12 måneder" },
  { value: "q1", label: "Q1 i år" },
  { value: "q2", label: "Q2 i år" },
  { value: "q3", label: "Q3 i år" },
  { value: "q4", label: "Q4 i år" },
  { value: "custom", label: "Egendefinert…" },
];

export const COMPARE_LABELS: Array<{ value: ComparePreset; label: string }> = [
  { value: "same_period_last_year", label: "Samme periode i fjor" },
  { value: "previous_period", label: "Forrige tilsvarende periode" },
  { value: "custom", label: "Egendefinert" },
  { value: "none", label: "Ingen sammenligning" },
];
