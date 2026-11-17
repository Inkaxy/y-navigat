// Nye varer: en rad blir bare kvittering når serveren har bekreftet at minst én fakturalinje ble endret.
// rm_link_supplier_item svarer ok:true med lines_updated=0 og skriver INGENTING når ingen av linjene kan
// endres lenger (internt godkjent faktura, ført kostpris, avsluttet/flagget faktura). Det er ikke en suksess.
export class NothingSavedError extends Error {
  readonly nothingSaved = true;
}

export const NOTHING_LINKED =
  "Ingenting ble lagret – ingen fakturalinjer ble endret. Linjene kan ikke endres herfra (fakturaen kan være godkjent internt, ha ført kostpris eller være avsluttet). Åpne fakturaen for å se hvorfor.";

/** Kaster når lagringen ikke endret noen linjer. */
export function assertLinesSaved(r: { lines_updated: number }): void {
  if (!(Number.isFinite(r.lines_updated) && r.lines_updated > 0)) throw new NothingSavedError(NOTHING_LINKED);
}

/** Åpne linjer delt i de som kan kobles og de som er låst (internt godkjent faktura eller ført kostpris – se `lineLocked`). */
export function splitLockedLines<T>(open: readonly T[], isLocked: (l: T) => boolean): { linkable: T[]; locked: T[] } {
  const linkable: T[] = [], locked: T[] = [];
  for (const l of open) (isLocked(l) ? locked : linkable).push(l);
  return { linkable, locked };
}
