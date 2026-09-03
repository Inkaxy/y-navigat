/**
 * Datoformatering for ordrekontorets statuslinje.
 *
 * Ligger i en egen modul (ikke i komponentfilen) slik at Fast Refresh beholder
 * komponent-only-eksport i `OrderDeskHeader.tsx`, og slik at formatene kan
 * enhetstestes uten å rendre React.
 */

const DATE_FMT = new Intl.DateTimeFormat("nb-NO", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Oslo",
});

const TIME_FMT = new Intl.DateTimeFormat("nb-NO", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Oslo",
});

/** «Torsdag 3. september 2026» — norsk dato med stor forbokstav. */
export function formatNorwegianToday(date: Date): string {
  const text = DATE_FMT.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «Sist oppdatert kl. 09:14» — eller en tydelig tekst før første henting. */
export function formatLastUpdated(dataUpdatedAt: number): string {
  if (!dataUpdatedAt) return "Ikke oppdatert ennå";
  return `Sist oppdatert kl. ${TIME_FMT.format(new Date(dataUpdatedAt))}`;
}
