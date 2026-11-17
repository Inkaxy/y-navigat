// Felles regel for link-supplier-item: et svar med fryst linjeutvalg (`line_ids`) og 0 endrede linjer betyr at
// INGENTING ble lagret – rm_link_supplier_item svarer ok uten å skrive når alle valgte linjer er låst (internt
// godkjent, ført kostpris, avsluttet) eller allerede løst. Det skal aldri vises som en vellykket lagring.
// Uten linjeutvalg (eldre opprett-veier) lagres koblingen/varen selv med 0 linjer, så der gjelder ikke regelen.
export class NothingSavedError extends Error {
  readonly nothingSaved = true;
}

export const NOTHING_LINKED =
  "Ingenting ble lagret – ingen fakturalinjer ble endret. Linjene kan ikke endres herfra (fakturaen kan være godkjent internt, ha ført kostpris, være avsluttet, eller linjene er allerede løst). Åpne fakturaen for å se hvorfor.";

/** Kaster når en lagring med linjeutvalg ikke endret noen linjer. */
export function assertScopedLinkSaved(body: { line_ids?: readonly string[] | null }, r: { lines_updated: number }): void {
  if (body.line_ids == null) return;
  if (!(Number.isFinite(r.lines_updated) && r.lines_updated > 0)) throw new NothingSavedError(NOTHING_LINKED);
}
