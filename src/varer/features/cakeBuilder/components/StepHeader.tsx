import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatKr } from "@/varer/lib/pricing";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepHeaderProps {
  categoryName: string;
  stepIndex: number;
  totalSteps: number;
  totalExMva: number;
  totalIncMva: number;
  showVat: boolean;
  onToggleVat: (next: boolean) => void;
  showVatToggle?: boolean;
  isCalculating?: boolean;
}

export function StepHeader({
  categoryName,
  stepIndex,
  totalSteps,
  totalExMva,
  totalIncMva,
  showVat,
  onToggleVat,
  showVatToggle = true,
  isCalculating,
}: StepHeaderProps) {
  const total = showVat ? totalIncMva : totalExMva;

  return (
    <div className="border-b border-line-subtle bg-surface-raised sticky top-0 z-20">
      <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="eyebrow">Kakebygger</p>
          <h1 className="font-display text-xl text-ink-primary truncate">{categoryName}</h1>
          <div className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-ink-tertiary">
            Steg {stepIndex + 1} av {totalSteps}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {showVatToggle && (
            <div className="flex items-center gap-2">
              <Switch id="vat-toggle" checked={showVat} onCheckedChange={onToggleVat} />
              <Label
                htmlFor="vat-toggle"
                className="text-[11px] uppercase tracking-[0.14em] text-ink-tertiary cursor-pointer"
              >
                {showVat ? "ink. mva" : "eks. mva"}
              </Label>
            </div>
          )}
          <div className="flex items-center gap-2">
            {isCalculating && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-tertiary" />}
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.14em] text-ink-tertiary">Sum</div>
              <span className="font-display text-lg text-ink-primary tabular-nums">
                {formatKr(total)} kr
              </span>
            </div>
          </div>
        </div>
      </div>
      <ol aria-hidden="true" className="flex items-center gap-1.5 px-4 pb-3">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <li key={i} className="flex flex-1 items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full transition-all",
                i === stepIndex
                  ? "h-2 w-2 bg-brand-gold ring-4 ring-brand-gold/20"
                  : i < stepIndex
                    ? "bg-brand-gold"
                    : "bg-line",
              )}
            />
            {i < totalSteps - 1 && (
              <span
                className={cn("h-px flex-1", i < stepIndex ? "bg-brand-gold/50" : "bg-line-subtle")}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
