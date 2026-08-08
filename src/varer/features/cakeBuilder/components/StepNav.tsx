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
    <div className="border-t border-line-subtle bg-surface-raised sticky bottom-0 z-20">
      {validationMessage && (
        <div className="px-4 py-2 text-xs text-danger bg-danger/8 border-b border-danger/20">
          {validationMessage}
        </div>
      )}
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isCompleting}
          className="rounded-full text-ink-tertiary hover:text-ink-primary"
        >
          <X className="h-4 w-4" /> Avbryt
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            disabled={isFirst || isCompleting}
            className="rounded-full border-line-subtle bg-surface-raised hover:border-brand-gold hover:bg-surface-sunken"
          >
            <ArrowLeft className="h-4 w-4" /> Tilbake
          </Button>
          {isLast ? (
            <Button
              size="sm"
              onClick={onComplete}
              disabled={!canProceed || isCompleting}
              className="rounded-full px-6 bg-brand-ink text-brand-cream hover:bg-brand-ink-deep dark:bg-brand-gold dark:text-brand-ink-deep dark:hover:bg-brand-bronze-soft"
            >
              {isCompleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{" "}
              {isCompleting ? "Behandler…" : "Ferdig"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onNext}
              disabled={!canProceed}
              className="rounded-full px-6 bg-brand-ink text-brand-cream hover:bg-brand-ink-deep dark:bg-brand-gold dark:text-brand-ink-deep dark:hover:bg-brand-bronze-soft"
            >
              Neste <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
