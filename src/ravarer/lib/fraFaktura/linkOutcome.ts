// Nye varer: en rad blir bare kvittering når serveren har bekreftet at minst én fakturalinje ble endret.
// rm_link_supplier_item svarer ok:true med lines_updated=0 og skriver INGENTING når ingen av linjene kan
// endres lenger (internt godkjent faktura, ført kostpris, avsluttet/flagget faktura). Det er ikke en suksess.
import { NOTHING_LINKED, NothingSavedError } from "@/fakturaer/lib/linkSaved";
import { isOpenLine } from "@/fakturaer/lib/linkFormLogic";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";
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

/**
 * Linjen kan i det hele tatt sendes til koblingen: til kontroll, faktura åpen (imported/needs_review/ready) og ikke
 * flagget, og ikke «ikke vare». Samme utvalg som rm_link_supplier_item og køen (20261121_kobling_godkjent_faktura);
 * godkjenning og ført kost avgjøres separat av `lockedForLink`. Linjer på avstemte eller flaggede fakturaer sendes aldri.
 */
export function isLinkableOpenLine(l: Pick<SupplierItemLine, "requires_review" | "invoice_status" | "flagged_at" | "match_confidence">): boolean {
  return isOpenLine(l) && l.match_confidence !== "not_applicable";
}

/**
 * Prishopp › «Feil pakning» (lagres via koblingen): sperret når ingen åpen linje kan tas av koblingen — alle har ført
 * kostpris, eller ligger på internt godkjent faktura uten at databasen godtar det ennå (ukjent = låst).
 */
export function packageFixLocked(lines: readonly Pick<SupplierItemLine, "requires_review" | "invoice_approved" | "cost_posted">[], approvedLinkable: boolean | null): boolean {
  const open = lines.filter((l) => l.requires_review === true);
  return open.length > 0 && open.every((l) => lockedForLink(l.cost_posted === true ? "cost" : l.invoice_approved === true ? "approved" : null, approvedLinkable));
}
