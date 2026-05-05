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
import { usePackingAreaUsage } from "../hooks/usePackingAreas";
import type { PackingArea } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area: PackingArea | null;
  onConfirm: () => void;
  isPending: boolean;
}

export function ArchiveConfirmDialog({
  open,
  onOpenChange,
  area,
  onConfirm,
  isPending,
}: Props) {
  const usageQuery = usePackingAreaUsage(area?.id);
  const usageCount = usageQuery.data ?? 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Arkivere "{area?.display_name}"?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {usageCount > 0 ? (
              <>
                {usageCount}{" "}
                {usageCount === 1 ? "produkt bruker" : "produkter bruker"} dette
                pakkeområdet. Arkivering skjuler det i pakke-valg, men eksisterende
                koblinger beholdes.
              </>
            ) : (
              <>
                Området vil ikke lenger være tilgjengelig for nye koblinger.
                Du kan gjenopprette det senere.
              </>
            )}
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
