import { useState, useEffect } from "react";
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
import { Loader2, AlertTriangle } from "lucide-react";

export function DeleteOrderDialog({
  open,
  onOpenChange,
  orderNumber,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber: string;
  onConfirm: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const canSubmit = text.trim().toUpperCase() === "SLETT";

  async function handleConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Slett ordre {orderNumber}?
          </DialogTitle>
          <DialogDescription>
            Dette sletter ordren og alle ordrelinjer permanent. Handlingen kan ikke angres.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="delete-confirm">
            Skriv <span className="font-mono font-semibold">SLETT</span> for å bekrefte
          </Label>
          <Input
            id="delete-confirm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="SLETT"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Avbryt
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Slett ordre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
