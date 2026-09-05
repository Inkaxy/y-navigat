/**
 * Datohjelpere som ALLTID regner i Europe/Oslo.
 *
 * En rå `toISOString().slice(0, 10)` gir gårsdagens dato mellom 00:00 og
 * 02:00 norsk sommertid (og 00:00–01:00 vintertid), fordi ISO-strengen er UTC.
 * Alle default-datoer (leveringsdato, prisdato, gyldig-fra) og datofiltre mot
 * databasen skal bruke disse funksjonene i stedet.
 */

const osloFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD for et gitt tidspunkt, sett fra Europe/Oslo. */
export function osloDateISO(date: Date | string | number = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA gir allerede YYYY-MM-DD
  return osloFormatter.format(d);
}

/** Dagens dato (YYYY-MM-DD) i Europe/Oslo. */
export function osloTodayISO(): string {
  return osloDateISO(new Date());
}

/** Dagens dato pluss N dager (kan være negativ), i Europe/Oslo. */
export function osloDateISOPlusDays(days: number, from: Date = new Date()): string {
  return osloDateISO(new Date(from.getTime() + days * 86_400_000));
}

/** Returnerer offset i minutter for Europe/Oslo på gitt tidspunkt (f.eks. 120 for sommertid). */
function osloOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

function osloIso(dateStr: string, timePart: string): string {
  // Første gjetning i UTC, deretter juster med faktisk Oslo-offset.
  const guess = new Date(`${dateStr}T${timePart}Z`);
  const offset = osloOffsetMinutes(guess);
  const exact = new Date(guess.getTime() - offset * 60000);
  // Offset kan endres over DST-grensen — juster én gang til.
  const offset2 = osloOffsetMinutes(exact);
  return new Date(guess.getTime() - offset2 * 60000).toISOString();
}

/** ISO-timestamp for 00:00:00 Oslo-tid på gitt dato (YYYY-MM-DD). */
export function osloDayStartIso(dateStr: string): string {
  return osloIso(dateStr, "00:00:00.000");
}

/** ISO-timestamp for 23:59:59.999 Oslo-tid på gitt dato (YYYY-MM-DD). */
export function osloDayEndIso(dateStr: string): string {
  return osloIso(dateStr, "23:59:59.999");
}
