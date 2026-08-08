import { Input } from "@/components/ui/input";
import type { WizardStep } from "../types";

interface NumberInputStepProps {
  step: WizardStep;
  value: string;
  onChange: (value: string) => void;
}

export function NumberInputStep({ step, value, onChange }: NumberInputStepProps) {
  return (
    <div className="space-y-2 max-w-xs">
      <Input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={step.description ?? "Skriv inn tall"}
        min={step.min_selections ?? undefined}
        max={step.max_selections ?? undefined}
        className="rounded-xl border-line-subtle bg-surface-sunken/60 px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary/70 transition-colors focus-visible:border-brand-gold focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-brand-gold/25"
      />
      {(step.min_selections != null || step.max_selections != null) && (
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink-tertiary">
          {step.min_selections != null && `Min: ${step.min_selections}`}
          {step.min_selections != null && step.max_selections != null && " · "}
          {step.max_selections != null && `Maks: ${step.max_selections}`}
        </div>
      )}
    </div>
  );
}
