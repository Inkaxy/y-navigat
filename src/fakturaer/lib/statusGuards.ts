/**
 * Statusvern for fakturaer — én kilde til hvilke handlinger som er lov i
 * hvilken status. Frontend skal aldri tilby en handling som backend eller
 * arbeidsflyten uansett vil avvise.
 *
 * Statuser: imported, needs_review, ready, reconciled, flagged.
 */

export type InvoiceAction =
  | "fetch_lines"
  | "match"
  | "resolve"
  | "reconcile"
  | "flag"
  | "unflag"
  | "register_lines";

/** Endelige statuser — fakturaen er ute av arbeidsflyten. */
export const FINAL_INVOICE_STATUSES = ["reconciled", "flagged"] as const;

const OPEN_ACTIONS: readonly InvoiceAction[] = [
  "fetch_lines",
  "match",
  "resolve",
  "reconcile",
  "flag",
  "register_lines",
];

/**
 * Handlingene som er tillatt for en gitt fakturastatus.
 * - flagget: bare «fjern flagg» (fakturaen må åpnes igjen først)
 * - avstemt: ingen endringer
 * - alt annet: full arbeidsflyt
 */
export function allowedInvoiceActions(status: string | null | undefined): InvoiceAction[] {
  switch (status) {
    case "flagged":
      return ["unflag"];
    case "reconciled":
      return [];
    default:
      return [...OPEN_ACTIONS];
  }
}

export function canDoInvoiceAction(status: string | null | undefined, action: InvoiceAction): boolean {
  return allowedInvoiceActions(status).includes(action);
}

/** Forklaring til brukeren når handlingen er sperret av statusen. */
export function invoiceActionBlockedReason(
  status: string | null | undefined,
  action: InvoiceAction,
): string | null {
  if (canDoInvoiceAction(status, action)) return null;
  if (status === "flagged") return "Fakturaen er flagget. Fjern flagget først.";
  if (status === "reconciled") return "Fakturaen er avstemt og kan ikke endres.";
  return "Handlingen er ikke tilgjengelig for denne fakturaen.";
}

/**
 * Kan linjene registreres på nytt? «Registrer linjer» erstatter ALLE linjer,
 * så den er sperret når fakturaen har matchede linjer eller er avstemt.
 */
export function canReplaceInvoiceLines(input: {
  status: string | null | undefined;
  matchedLineCount: number;
}): { allowed: boolean; requiresConfirm: boolean; reason: string | null } {
  if (input.status === "reconciled") {
    return { allowed: false, requiresConfirm: false, reason: "Fakturaen er avstemt og kan ikke endres." };
  }
  if (input.status === "flagged") {
    return { allowed: false, requiresConfirm: false, reason: "Fakturaen er flagget. Fjern flagget først." };
  }
  if (input.matchedLineCount > 0) {
    return {
      allowed: false,
      requiresConfirm: false,
      reason: `Fakturaen har ${input.matchedLineCount} matchede linjer. Fjern matchene før du registrerer linjene på nytt.`,
    };
  }
  return { allowed: true, requiresConfirm: true, reason: null };
}
