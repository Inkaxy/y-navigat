/**
 * Feilhåndtering mot bruker.
 *
 * Rå Postgres-/RLS-meldinger skal aldri vises i grensesnittet — de kan avsløre
 * constraint-navn, kolonner og policy-detaljer. Bruk `showError` overalt hvor en
 * databasefeil skal formidles, og les den tekniske feilen i konsollen.
 */
import { toast } from "sonner";

export const GENERIC_ERROR_MESSAGE =
  "Kunne ikke lagre. Prøv igjen — kontakt support hvis det gjentar seg.";

/** Logger den tekniske feilen og viser en kort, brukervennlig melding. */
export function showError(
  context: string,
  error: unknown,
  message: string = GENERIC_ERROR_MESSAGE,
): void {
  console.error(`[${context}]`, error);
  toast.error(message);
}
