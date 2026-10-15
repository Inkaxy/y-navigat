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

export type InvoiceLineLock =
  | { locked: false }
  | { locked: true; kind: "final" | "approved" | "unknown"; note: string };

/**
 * Om fakturalinjene er skrivebeskyttet. Speiler serverens livsløpsvern: aktiv intern godkjenning,
 * utelatt/avstemt/flagget eller ukjent godkjenningsstatus gir lås (fail-closed). Gjenåpning skjer
 * bare via eksisterende styrte veier (trekk godkjenning / gjenåpne utelatelse), aldri automatisk.
 */
export function invoiceLineLock(
  status: string | null | undefined,
  excludedAt: string | null | undefined,
  approval: { approved: boolean; known: boolean | undefined },
): InvoiceLineLock {
  const fin = finalLockNote(status, excludedAt);
  if (fin) return { locked: true, kind: "final", note: fin };
  if (approval.known !== true) return { locked: true, kind: "unknown", note: "Godkjenningsstatus er ikke kjent ennå — linjene er låst til den er hentet" };
  if (approval.approved) return { locked: true, kind: "approved", note: "Fakturaen er allerede internt godkjent — linjene vises skrivebeskyttet. Ny kontroll krever at godkjenningen trekkes tilbake med begrunnelse." };
  return { locked: false };
}
