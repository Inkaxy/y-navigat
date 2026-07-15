// SLA-beregning for tickets. Frister er per intensjon i timer, regnet i åpningstid.
import type { RequestType } from "@/ordre/lib/aiSuggestion";

export type SlaDeadlines = Partial<Record<RequestType, number>>;
export type BusinessHours = { start_hour: number; end_hour: number; workdays: number[] };

export const DEFAULT_SLA: SlaDeadlines = {
  complaint: 2,
  change: 4,
  new_order: 4,
  cancellation: 4,
  question: 8,
};

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  start_hour: 8,
  end_hour: 16,
  workdays: [1, 2, 3, 4, 5],
};

function isWorkday(d: Date, wd: number[]) {
  return wd.includes(d.getDay());
}

/** Legg til N åpningstid-timer til dato, returner deadline. */
export function addBusinessHours(from: Date, hours: number, bh: BusinessHours): Date {
  const remainingMs = hours * 3600_000;
  let cur = new Date(from);
  let remaining = remainingMs;
  const dayLen = (bh.end_hour - bh.start_hour) * 3600_000;

  // Klemme starttid til nærmeste åpningstid
  const clampToOpen = (d: Date) => {
    while (!isWorkday(d, bh.workdays)) {
      d.setDate(d.getDate() + 1);
      d.setHours(bh.start_hour, 0, 0, 0);
    }
    if (d.getHours() < bh.start_hour) d.setHours(bh.start_hour, 0, 0, 0);
    if (d.getHours() >= bh.end_hour) {
      d.setDate(d.getDate() + 1);
      d.setHours(bh.start_hour, 0, 0, 0);
      clampToOpen(d);
    }
  };
  clampToOpen(cur);

  while (remaining > 0) {
    const endOfDay = new Date(cur);
    endOfDay.setHours(bh.end_hour, 0, 0, 0);
    const avail = endOfDay.getTime() - cur.getTime();
    if (avail >= remaining) {
      cur = new Date(cur.getTime() + remaining);
      remaining = 0;
    } else {
      remaining -= avail;
      cur = new Date(cur);
      cur.setDate(cur.getDate() + 1);
      cur.setHours(bh.start_hour, 0, 0, 0);
      clampToOpen(cur);
    }
    if (dayLen <= 0) break; // safeguard
  }
  return cur;
}

export function computeDeadline(
  receivedAt: string | Date,
  intent: RequestType | null | undefined,
  sla: SlaDeadlines,
  bh: BusinessHours,
): Date | null {
  if (!intent) return null;
  const hours = sla[intent] ?? DEFAULT_SLA[intent];
  if (!hours) return null;
  return addBusinessHours(new Date(receivedAt), hours, bh);
}

export function formatCountdown(deadline: Date, now: Date = new Date()): { text: string; overdue: boolean } {
  const diff = deadline.getTime() - now.getTime();
  const overdue = diff < 0;
  const mins = Math.abs(Math.round(diff / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const label = h > 0 ? `${h}t ${m}m` : `${m}m`;
  return { text: overdue ? `frist brutt ${label}` : `${label} igjen`, overdue };
}
