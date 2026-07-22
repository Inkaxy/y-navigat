// Overstyringsdialog for ordrekontoret. Layout matcher venstre kort i
// leveringsregel-skjermbildet: rød regelblokk, grønn «du har tilgang»-badge,
// påkrevd begrunnelse (min. 10 tegn), og forklaring om revisjonslogg.

import { useState } from "react";
import { AlertOctagon, CheckCircle2, Lock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DeliveryRuleHit } from "@/ordre/hooks/usePreviewDeliveryRules";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: DeliveryRuleHit[];
  /** Kort kontekstsetning, f.eks. «Ordre til Kafé Fjellstua · levering torsdag 17. juli». */
  contextLine?: string;
  onConfirm: (reason: string) => void | Promise<void>;
  submitting?: boolean;
};

const MIN_REASON = 10;

export function OverrideRuleDialog({
  open,
  onOpenChange,
  blocks,
  contextLine,
  onConfirm,
  submitting = false,
}: Props) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_REASON;

  async function handleConfirm() {
    if (!valid) return;
    await onConfirm(trimmed);
    setReason("");
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setReason("");
        onOpenChange(v);
      }}
    >
      <AlertDialogContent className="max-w-lg bg-[hsl(var(--brand-cream))] text-[hsl(var(--brand-ink))]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertOctagon className="h-5 w-5" />
            Leveringsregel blokkerer ordren
          </AlertDialogTitle>
          {contextLine && (
            <div className="text-sm text-muted-foreground">{contextLine}</div>
          )}
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
            {blocks.map((h) => (
              <div key={h.rule_id} className="text-sm">
                <div className="font-semibold text-destructive">
                  «{h.rule_name}»
                  {typeof h.priority === "number" && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      (prioritet {h.priority})
                    </span>
                  )}
                </div>
                <div className="mt-0.5">{h.message}</div>
              </div>
            ))}
          </div>

          <div className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Du har ordrekontor-tilgang og kan overstyre
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="override-reason" className="text-xs uppercase tracking-wide">
              Begrunnelse for overstyring (påkrevd)
            </Label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Beskriv hvorfor ordren likevel må lagres — f.eks. avklart med produksjon, kunde varslet, ekstra tur satt opp."
              autoFocus
            />
            <div className="text-xs text-muted-foreground">
              Minst {MIN_REASON} tegn.{" "}
              {trimmed.length > 0 && trimmed.length < MIN_REASON && (
                <span className="text-destructive">
                  ({MIN_REASON - trimmed.length} igjen)
                </span>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              Overstyringen logges i revisjonsloggen med navnet ditt, regelen og
              begrunnelsen. Kun ordrekontoret i NBHub kan overstyre — portal,
              kiosk og fastordre stoppes alltid.
            </div>
          </div>
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Avbryt
          </Button>
          <Button
            variant="brand"
            onClick={handleConfirm}
            disabled={!valid || submitting}
          >
            Overstyr og lagre ordren
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
