import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { formatKr } from "@/varer/lib/pricing";
import { Loader2 } from "lucide-react";

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
  const progress = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;

  return (
    <div className="border-b bg-card sticky top-0 z-20">
      <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate">{categoryName}</h1>
          <div className="text-xs text-muted-foreground">
            Steg {stepIndex + 1} av {totalSteps}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {showVatToggle && (
            <div className="flex items-center gap-2">
              <Switch id="vat-toggle" checked={showVat} onCheckedChange={onToggleVat} />
              <Label htmlFor="vat-toggle" className="text-xs cursor-pointer">
                {showVat ? "ink. mva" : "eks. mva"}
              </Label>
            </div>
          )}
          <div className="flex items-center gap-2">
            {isCalculating && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Badge variant="secondary" className="text-base font-semibold px-3 py-1">
              {formatKr(total)} kr
            </Badge>
          </div>
        </div>
      </div>
      <Progress value={progress} className="h-1 rounded-none" />
    </div>
  );
}
