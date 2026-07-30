// Norwegian relative-date label for the delivery-note dashboard date navigator.
import { osloDateISO } from "@/lib/osloDate";
// Returns { label, tone } where tone helps choose past/future colour.

const WEEKDAYS_LONG = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** ISO 8601 week number */
function isoWeekNumber(d: Date): number {
  const target = new Date(d.getTime());
  target.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / 86_400_000 / 7);
}

export function relativeDateLabel(isoDate: string): { label: string; tone: "past" | "today" | "future" } {
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(isoDate + "T12:00:00"));
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const weekday = WEEKDAYS_LONG[target.getDay()];

  let label: string;
  if (diffDays === 0) label = `i dag, ${weekday}`;
  else if (diffDays === 1) label = `i morgen, ${weekday}`;
  else if (diffDays === -1) label = `i går, ${weekday}`;
  else if (diffDays >= 2 && diffDays <= 6) label = `om ${diffDays} dager, ${weekday}`;
  else if (diffDays <= -2 && diffDays >= -6) label = `for ${Math.abs(diffDays)} dager siden, ${weekday}`;
  else label = `${weekday} uke ${isoWeekNumber(target)}`;

  const tone: "past" | "today" | "future" = diffDays === 0 ? "today" : diffDays > 0 ? "future" : "past";
  return { label, tone };
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return osloDateISO(d);
}
