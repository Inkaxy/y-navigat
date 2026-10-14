/** Visningsregler for avsluttede fakturaer. Holdt utenfor er ikke flagget og ikke en ny avklaring. */
export function isExcludedInvoice(status: string | null | undefined, excludedAt: string | null | undefined): boolean {
  return status === "excluded" || !!excludedAt;
}

export function finalLockNote(status: string | null | undefined, excludedAt: string | null | undefined): string | null {
  if (isExcludedInvoice(status, excludedAt)) return "Holdt utenfor råvarebehandling — linjene er låst";
  if (status === "reconciled") return "Fakturaen er avstemt — linjene er låst";
  if (status === "flagged") return "Fakturaen er flagget — linjene er låst";
  return null;
}
