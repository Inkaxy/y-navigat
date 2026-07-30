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
