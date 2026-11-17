// Nye varer: en rad blir bare kvittering når serveren har bekreftet at minst én fakturalinje ble endret.
// rm_link_supplier_item svarer ok:true med lines_updated=0 og skriver INGENTING når ingen av linjene kan
// endres lenger (internt godkjent faktura, ført kostpris, avsluttet/flagget faktura). Det er ikke en suksess.
import { NOTHING_LINKED, NothingSavedError } from "@/fakturaer/lib/linkSaved";
export { NOTHING_LINKED, NothingSavedError };

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

/** Feilteksten når lagringen ikke endret noen linjer og alle linjene viser seg å ligge på godkjente fakturaer. */
export const NOT_LINKED_APPROVED = "Kunne ikke kobles: linjene ligger på fakturaer som allerede er godkjent. Ingenting ble lagret.";

/**
 * Er linjen låst for kobling fra Nye varer? Ført kostpris låser alltid. Intern godkjenning låser til databasen
 * bekrefter at koblingen godtar godkjente, åpne fakturaer (`rm_cap_kobling_godkjent_v1` = true); ukjent = låst.
 */
export function lockedForLink(lock: "approved" | "cost" | null, approvedLinkable: boolean | null): boolean {
  if (lock === "cost") return true;
  if (lock === "approved") return approvedLinkable !== true;
  return false;
}
