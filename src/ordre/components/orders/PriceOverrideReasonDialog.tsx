import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PriceOverrideReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string | null;
  /** Prisen fra prismotoren, til sammenligning. */
  originalPrice: string | null;
  newPrice: string | null;
  onConfirm: (reason: string) => void;
  /** Kalles når brukeren avbryter — prisen settes tilbake. */
  onCancel: () => void;
};

/** Krever en kort begrunnelse når operatøren overstyrer prisen manuelt. */
export function PriceOverrideReasonDialog({
  open,
  onOpenChange,
  productName,
  originalPrice,
  newPrice,
  onConfirm,
  onCancel,
}: PriceOverrideReasonDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const canSave = reason.trim().length >= 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Begrunn prisoverstyringen</DialogTitle>
          <DialogDescription>
            {productName ? `${productName}: ` : ""}
            {originalPrice ? `fra ${originalPrice} kr ` : ""}
            {newPrice ? `til ${newPrice} kr. ` : ""}
            Begrunnelsen lagres på linjen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="price-override-reason">Begrunnelse</Label>
          <Input
            id="price-override-reason"
            value={reason}
            autoFocus
            maxLength={120}
            placeholder="F.eks. avtalt pris med kunden på telefon"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) {
                e.preventDefault();
                onConfirm(reason.trim());
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onCancel();
              onOpenChange(false);
            }}
          >
            Avbryt
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => onConfirm(reason.trim())}>
            Lagre begrunnelse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
