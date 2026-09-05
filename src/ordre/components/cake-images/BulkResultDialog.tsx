import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";

export type BulkOutcome = "ok" | "skipped" | "error";

export type BulkResultRow = {
  id: string;
  label: string;
  outcome: BulkOutcome;
  reason?: string;
};

const ICON = {
  ok: CheckCircle2,
  skipped: MinusCircle,
  error: XCircle,
} as const;

const TEXT = {
  ok: "text-emerald-700",
  skipped: "text-amber-700",
  error: "text-destructive",
} as const;

/** Oppsummering per bilde etter en bulk-handling: hva gikk gjennom, hva ikke. */
export function BulkResultDialog({
  open,
  title,
  rows,
  onClose,
}: {
  open: boolean;
  title: string;
  rows: BulkResultRow[];
  onClose: () => void;
}) {
  const ok = rows.filter((r) => r.outcome === "ok").length;
  const skipped = rows.filter((r) => r.outcome === "skipped").length;
  const failed = rows.filter((r) => r.outcome === "error").length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {ok} gjennomført · {skipped} hoppet over · {failed} feilet
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[50vh] space-y-1 overflow-auto text-sm">
          {rows.map((r) => {
            const Icon = ICON[r.outcome];
            return (
              <li key={r.id} className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TEXT[r.outcome]}`} />
                <span>
                  <span className="font-medium">{r.label}</span>
                  {r.reason ? (
                    <span className="text-muted-foreground"> — {r.reason}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button onClick={onClose}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
