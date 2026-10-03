import { toast } from "sonner";

/**
 * Melding etter enkeltgodkjenning. «Bruk på flere» tilbys som et bevisst
 * sekundærvalg — massekoblingsdialogen åpnes aldri automatisk.
 */
export function notifyAccepted(name: string, rmsId: string | null, openBulk: (rmsId: string, name: string) => void): void {
  toast.success(
    `Koblet til ${name}`,
    rmsId ? { action: { label: "Bruk på flere", onClick: () => openBulk(rmsId, name) } } : undefined,
  );
}
