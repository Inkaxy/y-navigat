import { OptionCard } from "../components/OptionCard";
import type { WizardStep } from "../types";

interface MultiSelectStepProps {
  step: WizardStep;
  selectedOptionIds: string[];
  onToggle: (optionId: string) => void;
  showVat: boolean;
}

export function MultiSelectStep({ step, selectedOptionIds, onToggle, showVat }: MultiSelectStepProps) {
  if (step.options.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-subtle py-10 text-center text-sm text-ink-tertiary">
        Ingen valg er konfigurert for dette steget.
      </div>
    );
  }
  const max = step.max_selections;
  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-ink-tertiary">
        Velg {step.min_selections ?? 0}
        {max ? `–${max}` : "+"} ({selectedOptionIds.length} valgt)
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
        {step.options.map((opt) => {
          const selected = selectedOptionIds.includes(opt.option_id);
          const atMax = max != null && selectedOptionIds.length >= max && !selected;
          return (
            <OptionCard
              key={opt.option_id}
              option={opt}
              selected={selected}
              onClick={() => {
                if (atMax) return;
                onToggle(opt.option_id);
              }}
              showVat={showVat}
              multi
            />
          );
        })}
      </div>
    </div>
  );
}
