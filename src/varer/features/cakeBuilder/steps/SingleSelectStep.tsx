import { OptionCard } from "../components/OptionCard";
import type { WizardStep } from "../types";

interface SingleSelectStepProps {
  step: WizardStep;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
  showVat: boolean;
}

export function SingleSelectStep({ step, selectedOptionId, onSelect, showVat }: SingleSelectStepProps) {
  if (step.options.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-subtle py-10 text-center text-sm text-ink-tertiary">
        Ingen valg er konfigurert for dette steget.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
      {step.options.map((opt) => (
        <OptionCard
          key={opt.option_id}
          option={opt}
          selected={selectedOptionId === opt.option_id}
          onClick={() => onSelect(opt.option_id)}
          showVat={showVat}
        />
      ))}
    </div>
  );
}
