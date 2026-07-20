import { useState } from "react";
import { Undo2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUnfinalizeDeliveryNotes } from "@/ordre/hooks/useUnfinalizeDeliveryNotes";

type Props = {
  ids: string[];
  disabled?: boolean;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
  /** Label på knappen. Standard: "Tilbakekjør". Tom streng = kun ikon. */
  label?: string;
  /** Vises i dialogen som beskrivelse. */
  description?: string;
};

export function UnfinalizeButton({
  ids,
  disabled,
  size = "sm",
  variant = "outline",
  label = "Tilbakekjør",
  description,
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const unfinalize = useUnfinalizeDeliveryNotes();

  const count = ids.length;
  const isDisabled = disabled || count === 0 || unfinalize.isPending;

  async function onConfirm() {
    try {
      const r = await unfinalize.mutateAsync({ ids, reason: reason.trim() || null });
      if (r.updated === 0) {
        toast.error("Ingen pakksedler ble tilbakekjørt");
      } else {
        toast.success(
          `Tilbakekjørte ${r.updated} pakkseddel${r.updated === 1 ? "" : "er"}` +
            (r.blocked ? ` (${r.blocked} blokkert)` : ""),
        );
      }
      setOpen(false);
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Uventet feil");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={label ? "gap-2" : ""}
          disabled={isDisabled}
        >
          <Undo2 className="h-4 w-4" />
          {label && (
            <>
              {label}
              {count > 1 && ` (${count})`}
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Tilbakekjør {count} pakkseddel{count === 1 ? "" : "er"}
          </DialogTitle>
          <DialogDescription>
            {description ??
              "Pakkseddelen settes tilbake til utkast og fjernes fra kundeportalen. Kansellerte pakksedler kan ikke tilbakekjøres."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="unfinalize-reason">Årsak (valgfri)</Label>
          <Textarea
            id="unfinalize-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="F.eks. 'Feil linje – må korrigeres'"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={unfinalize.isPending}>
            Avbryt
          </Button>
          <Button onClick={onConfirm} disabled={unfinalize.isPending} className="gap-2">
            {unfinalize.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Tilbakekjører…
              </>
            ) : (
              <>
                <Undo2 className="h-4 w-4" /> Bekreft tilbakekjøring
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
