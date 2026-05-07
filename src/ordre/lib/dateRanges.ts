// Date-range helpers for the matrix quick-filter chips.
// All ISO YYYY-MM-DD strings, ISO week (Monday=1).

import { addDays, isoWeekMonday } from "@/hooks/useMatrix";
import { todayISO } from "@/lib/format";

export type QuickRange = "today" | "this_week" | "next_week";

export function rangeFor(kind: QuickRange): { from: string; to: string } {
  const today = todayISO();
  if (kind === "today") return { from: today, to: today };
  if (kind === "this_week") {
    const mon = isoWeekMonday(today);
    return { from: mon, to: addDays(mon, 6) };
  }
  // next_week
  const mon = addDays(isoWeekMonday(today), 7);
  return { from: mon, to: addDays(mon, 6) };
}

const STORAGE_PREFIX = "ordre_matrix_filter_";

export function loadStoredRange(customerId: string): QuickRange | null {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + customerId);
    if (v === "today" || v === "this_week" || v === "next_week") return v;
  } catch {
    // ignore
  }
  return null;
}

export function saveStoredRange(customerId: string, kind: QuickRange): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + customerId, kind);
  } catch {
    // ignore
  }
}

/** Build list of YYYY-MM-DD between from and to inclusive. */
export function buildDateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // safety bound
  for (let i = 0; i < 90 && cur <= to; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Norwegian net-amount formatter: "1 234,50 kr". 0 → "0,00 kr". */
const numFmt = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatKrNetto(value: number): string {
  return `${numFmt.format(value)} kr`;
}
