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

interface Props {
  open: boolean;
  text: { title: string; body: string; action: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Bekreftelse før overskriving av kladd, kilde eller lagret deklarasjon. */
export function ConfirmPendingDialog({ open, text, onCancel, onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        {text && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{text.title}</AlertDialogTitle>
              <AlertDialogDescription>{text.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Avbryt</AlertDialogCancel>
              <AlertDialogAction onClick={onConfirm}>{text.action}</AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
