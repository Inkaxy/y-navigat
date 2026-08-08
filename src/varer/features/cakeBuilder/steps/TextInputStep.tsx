import { Textarea } from "@/components/ui/textarea";
import type { WizardStep } from "../types";

interface TextInputStepProps {
  step: WizardStep;
  value: string;
  onChange: (value: string) => void;
}

export function TextInputStep({ step, value, onChange }: TextInputStepProps) {
  const max = step.max_selections;
  return (
    <div className="space-y-2 max-w-xl">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={step.description ?? "Skriv inn tekst som skal på kaken …"}
        maxLength={max ?? undefined}
        rows={3}
        className="rounded-xl border-line-subtle bg-surface-sunken/60 px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary/70 transition-colors focus-visible:border-brand-gold focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-brand-gold/25"
      />
      {max != null && (
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink-tertiary text-right">
          {value.length} / {max} tegn
        </div>
      )}
    </div>
  );
}
