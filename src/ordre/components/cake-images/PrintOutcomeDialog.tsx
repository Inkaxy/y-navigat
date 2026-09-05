import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PrintOutcome =
  | { ok: true }
  | { ok: false; reason: string }
  | { cancelled: true };

/**
 * «Kom arket ut riktig?» — status settes først når mennesket har sett papiret.
 * Avbryt endrer ingenting; Nei logges som feiltrykk med valgfri årsak.
 */
export function PrintOutcomeDialog({
  open,
  count,
  onResolve,
}: {
  open: boolean;
  count: number;
  onResolve: (outcome: PrintOutcome) => void;
}) {
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setFailing(false);
      setReason("");
    }
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onResolve({ cancelled: true })}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kom arket ut riktig?</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1
              ? "Ett kakebilde ble sendt til skriveren."
              : `${count} kakebilder ble sendt til skriveren.`}{" "}
            Svar «Ja» først når du har sjekket papiret — da settes status til
            skrevet ut.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {failing ? (
          <div className="space-y-2">
            <label className="text-xs font-medium" htmlFor="print-fail-reason">
              Hva gikk galt? (valgfritt)
            </label>
            <Input
              id="print-fail-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="F.eks. feil størrelse, striper i trykket"
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => onResolve({ cancelled: true })}>
            Avbryt
          </Button>
          {failing ? (
            <Button
              variant="destructive"
              onClick={() => onResolve({ ok: false, reason: reason.trim() })}
            >
              Registrer feiltrykk
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setFailing(true)}>
              Nei
            </Button>
          )}
          <Button onClick={() => onResolve({ ok: true })}>Ja</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
