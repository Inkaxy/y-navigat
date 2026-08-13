/**
 * Periodehåndtering for Rapporter. Bygger på de eksisterende presets i
 * Råvarer-appen, med tillegg av sammenligningsperioder.
 */
import {
  COMPARE_LABELS,
  PERIOD_PRESET_LABELS,
  rangeForPreset,
  type ComparePreset,
  type DateRange,
  type PeriodPreset,
} from "@/ravarer/lib/periodPresets";
import { osloDateISO } from "@/lib/osloDate";

export { COMPARE_LABELS, PERIOD_PRESET_LABELS, rangeForPreset };
export type { ComparePreset, DateRange, PeriodPreset };

const DAY = 86_400_000;

function shiftYears(iso: string, years: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return osloDateISO(d);
}

function dayDiff(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / DAY);
}

function shiftDays(iso: string, days: number): string {
  return osloDateISO(new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * DAY));
}

/** Beregnet sammenligningsperiode, eller null når «ingen sammenligning». */
export function comparisonRange(
  range: DateRange,
  compare: ComparePreset,
  custom?: DateRange | null,
): DateRange | null {
  if (!range.start || !range.end) return null;
  switch (compare) {
    case "same_period_last_year":
      return { start: shiftYears(range.start, -1), end: shiftYears(range.end, -1) };
    case "previous_period": {
      const len = dayDiff(range.start, range.end) + 1;
      const end = shiftDays(range.start, -1);
      return { start: shiftDays(end, -(len - 1)), end };
    }
    case "custom":
      return custom?.start && custom?.end ? custom : null;
    default:
      return null;
  }
}

/** Månedsnøkler (yyyy-mm-01) som dekker perioden. */
export function monthKeys(range: DateRange): string[] {
  if (!range.start || !range.end) return [];
  const out: string[] = [];
  const [sy, sm] = range.start.split("-").map(Number);
  const [ey, em] = range.end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const MONTH_NAMES = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function shortDate(iso: string): string {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
