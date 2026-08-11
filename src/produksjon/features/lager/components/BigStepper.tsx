import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  label?: string;
}

/** Stor stepper for nettbrett — knapper på minst 58px. */
export function BigStepper({ value, onChange, min = 0, step = 1, label }: Props) {
  return (
    <div className="flex items-center gap-4">
      <Button
        type="button"
        variant="outline"
        className="h-[58px] w-[58px] shrink-0 p-0"
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label="Reduser"
      >
        <Minus className="h-6 w-6" />
      </Button>
      <div className="min-w-[90px] text-center">
        <div className="text-4xl font-bold tabular-nums">{value}</div>
        {label && <div className="text-xs text-muted-foreground">{label}</div>}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-[58px] w-[58px] shrink-0 p-0"
        onClick={() => onChange(value + step)}
        aria-label="Øk"
      >
        <Plus className="h-6 w-6" />
      </Button>
    </div>
  );
}
