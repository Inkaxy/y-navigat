import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";

interface StepNavProps {
  isFirst: boolean;
  isLast: boolean;
  canProceed: boolean;
  onBack: () => void;
  onNext: () => void;
  onComplete: () => void;
  onCancel: () => void;
  validationMessage?: string | null;
  isCompleting?: boolean;
}

export function StepNav({
  isFirst,
  isLast,
  canProceed,
  onBack,
  onNext,
  onComplete,
  onCancel,
  validationMessage,
  isCompleting,
}: StepNavProps) {
  return (
    <div className="border-t bg-card sticky bottom-0 z-20">
      {validationMessage && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/5 border-b border-destructive/20">
          {validationMessage}
        </div>
      )}
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isCompleting}>
          <X className="h-4 w-4" /> Avbryt
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBack} disabled={isFirst || isCompleting}>
            <ArrowLeft className="h-4 w-4" /> Tilbake
          </Button>
          {isLast ? (
            <Button size="sm" onClick={onComplete} disabled={!canProceed || isCompleting}>
              {isCompleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{" "}
              {isCompleting ? "Behandler…" : "Ferdig"}
            </Button>
          ) : (
            <Button size="sm" onClick={onNext} disabled={!canProceed}>
              Neste <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}