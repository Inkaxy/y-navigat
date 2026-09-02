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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";
import { getStatusMeta, type OrderStatus } from "@/ordre/lib/orderStatus";

export type StatusChangeIntent = {
  to: OrderStatus;
  label: string;
  requireComment?: boolean;
  commentLabel?: string;
  /** Variant på bekreft-knappen */
  confirmVariant?: "default" | "destructive";
  /** Ekstra advarsel-tekst */
  warning?: string;
};


export function StatusChangeDialog({
  open,
  onOpenChange,
  intent,
  currentStatus,
  orderNumber,
  customerName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: StatusChangeIntent | null;
  currentStatus: OrderStatus;
  orderNumber: string;
  customerName: string;
  onConfirm: (comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setComment("");
  }, [open]);

  if (!intent) return null;

  const fromMeta = getStatusMeta(currentStatus);
  const toMeta = getStatusMeta(intent.to);
  const requireComment = intent.requireComment ?? false;
  const commentLabel = intent.commentLabel ?? "Kommentar (valgfri)";
  const canSubmit = !requireComment || comment.trim().length > 0;

  async function handleConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm(comment.trim());
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Endre status til {toMeta.label}</DialogTitle>
          <DialogDescription>
            Du endrer status på ordre <span className="font-mono font-medium">{orderNumber}</span> for{" "}
            <span className="font-medium">{customerName}</span> fra{" "}
            <span className="font-medium">{fromMeta.label}</span> til{" "}
            <span className="font-medium">{toMeta.label}</span>.
          </DialogDescription>
        </DialogHeader>

        {intent.warning && (
          <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
            <span>{intent.warning}</span>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="status-comment">
            {commentLabel}
            {requireComment && <span className="text-destructive"> *</span>}
          </Label>
          <Textarea
            id="status-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={requireComment ? "Skriv en grunn..." : "Valgfri kommentar"}
            rows={3}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Avbryt
          </Button>
          <Button
            variant={intent.confirmVariant ?? "default"}
            onClick={handleConfirm}
            disabled={!canSubmit || submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Bekreft endring
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
