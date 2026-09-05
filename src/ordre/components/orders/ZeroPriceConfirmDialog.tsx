import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ZeroPriceConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Antall linjer uten reell pris. */
  count: number;
  onConfirm: () => void;
};

/** Bekreftelse før en ordre lagres med linjer til 0 kr eller uten funnet pris. */
export function ZeroPriceConfirmDialog({
  open,
  onOpenChange,
  count,
  onConfirm,
}: ZeroPriceConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Lagre med 0 kr på {count === 1 ? "1 linje" : `${count} linjer`}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1
              ? "Én linje mangler pris eller står til 0 kr."
              : `${count} linjer mangler pris eller står til 0 kr.`}{" "}
            Ordren blir fakturert med disse beløpene. Sjekk prislisten hvis dette ikke er
            meningen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Gå tilbake</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Lagre likevel</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
