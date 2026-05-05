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
import type { LabelPrintProfile } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: LabelPrintProfile | null;
  onConfirm: () => void;
  isPending?: boolean;
}

export function ArchiveProfileDialog({
  open,
  onOpenChange,
  profile,
  onConfirm,
  isPending,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Arkiver profilen?</AlertDialogTitle>
          <AlertDialogDescription>
            Arkiver profilen "{profile?.name}"? Den kan gjenopprettes fra
            arkivert-seksjonen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Avbryt</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isPending}>
            {isPending ? "Arkiverer …" : "Arkiver"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
