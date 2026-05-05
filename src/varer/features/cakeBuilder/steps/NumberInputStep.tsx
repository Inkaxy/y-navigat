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
      />
      {(step.min_selections != null || step.max_selections != null) && (
        <div className="text-xs text-muted-foreground">
          {step.min_selections != null && `Min: ${step.min_selections}`}
          {step.min_selections != null && step.max_selections != null && " · "}
          {step.max_selections != null && `Maks: ${step.max_selections}`}
        </div>
      )}
    </div>
  );
}
