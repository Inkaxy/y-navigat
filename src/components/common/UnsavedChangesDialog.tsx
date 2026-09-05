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
import type { UnsavedGuardDialogProps } from "@/hooks/useUnsavedChangesGuard";

/** Felles dialog for `useUnsavedChangesGuard`. */
export function UnsavedChangesDialog({
  open,
  onDiscard,
  onStay,
  description,
}: UnsavedGuardDialogProps & { description?: string }) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onStay(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Du har ulagrede endringer</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? "Endringene forsvinner hvis du fortsetter uten å lagre."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>Bli på siden</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>Forkast endringer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
