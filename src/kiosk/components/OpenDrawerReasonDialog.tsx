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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}

const QUICK_REASONS = [
  "Vekslepenger",
  "Kontanttelling",
  "Feilslag – korreksjon",
  "Manuell utbetaling",
  "Rengjøring",
];

/**
 * Nødåpning av kasseskuffen — krever at operatøren oppgir en grunn før
 * hendelsen kan gjennomføres (kassasystemforskrifta § 2-8).
 */
export function OpenDrawerReasonDialog({ open, onOpenChange, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setBusy(false);
      setErr(null);
    }
  }, [open]);

  const canSubmit = reason.trim().length >= 3 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!busy ? onOpenChange(v) : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Åpne kasseskuff</DialogTitle>
          <DialogDescription>
            Åpning utenom salg må dokumenteres. Oppgi grunn — hendelsen
            journalføres med operatør og tidspunkt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant={reason === r ? "default" : "outline"}
                onClick={() => setReason(r)}
              >
                {r}
              </Button>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="drawer-reason">Grunn (påkrevd)</Label>
            <Textarea
              id="drawer-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Beskriv hvorfor skuffen må åpnes …"
              rows={3}
              autoFocus
            />
          </div>

          {err && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
              {err}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {busy ? "Åpner…" : "Åpne skuff"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
