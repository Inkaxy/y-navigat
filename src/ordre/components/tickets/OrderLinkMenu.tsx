import { useState } from "react";
import { Link2Off, MoreHorizontal, Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/** Sekundære handlinger for koblingen. Begge krever konkret bekreftelse. */
export default function OrderLinkMenu({
  orderNumber,
  canWrite,
  onSwitch,
  onUnlink,
}: {
  orderNumber: string;
  canWrite: boolean;
  onSwitch: () => void;
  onUnlink: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<"switch" | "unlink" | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!canWrite}
            aria-label="Flere valg for ordrekoblingen"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setConfirm("switch")}>
            <Replace className="mr-2 h-4 w-4" aria-hidden="true" /> Bytt ordre …
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm("unlink")}>
            <Link2Off className="mr-2 h-4 w-4" aria-hidden="true" /> Fjern kobling …
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "switch"
                ? `Bytte fra ordre #${orderNumber}?`
                : `Fjerne koblingen til ordre #${orderNumber}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "switch"
                ? "Du velger en annen ordre i neste steg. Ordre #" +
                  orderNumber +
                  " beholdes uendret; bare saken kobles om."
                : "Saken kobles fra ordren. Selve ordren beholdes uendret, og koblingen kan legges til igjen senere."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                if (confirm === "switch") {
                  setConfirm(null);
                  onSwitch();
                  return;
                }
                e.preventDefault();
                setBusy(true);
                try {
                  await onUnlink();
                  setConfirm(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirm === "switch" ? "Velg annen ordre" : "Fjern kobling"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
