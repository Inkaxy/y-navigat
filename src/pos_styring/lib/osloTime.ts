/**
 * Hjelpere for å bygge ISO-grenser som faktisk representerer et døgn i
 * Europe/Oslo. Uten dette blir `${dato}T00:00:00` tolket som UTC av
 * timestamptz-kolonnene, og salg mellom 00:00 og 02:00 norsk tid havner
 * på feil dato.
 */

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
