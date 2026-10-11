import { useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/** Grensen for når en handling uten angring må bekreftes. */
export const CONFIRM_LINE_THRESHOLD = 10;

export function needsManyConfirm(lineCount: number): boolean {
  return lineCount > CONFIRM_LINE_THRESHOLD;
}

/**
 * Bekreftelse før handlinger som ikke kan angres når de gjelder mer enn
 * 10 linjer. `guard(n, tekst, run)` kjører direkte under grensen.
 */
export function useConfirmMany(): { guard: (lines: number, what: string, run: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<{ text: string; run: () => void } | null>(null);
  const guard = (lines: number, what: string, run: () => void) => {
    if (!needsManyConfirm(lines)) run();
    else setPending({ text: `${what} gjelder ${lines} linjer og kan ikke angres.`, run });
  };
  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(v) => { if (!v) setPending(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Er du sikker?</AlertDialogTitle>
          <AlertDialogDescription>{pending?.text}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Avbryt</AlertDialogCancel>
          <AlertDialogAction onClick={() => { const r = pending?.run; setPending(null); r?.(); }}>Fortsett</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { guard, dialog };
}
