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
      />
      {max != null && (
        <div className="text-xs text-muted-foreground text-right">
          {value.length} / {max} tegn
        </div>
      )}
    </div>
  );
}
