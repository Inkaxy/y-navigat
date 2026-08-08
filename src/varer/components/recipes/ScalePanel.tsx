import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Scale, RotateCcw, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtG, fmtNum, type ScaledSummary } from "@/varer/lib/bakers";

interface Props {
  /** Ønsket antall enheter (fritekst så feltet kan tømmes mens man skriver). */
  value: string;
  onChange: (v: string) => void;
  baseUnits: number;
  mixerCapacity: string;
  onMixerCapacityChange: (v: string) => void;
  summary: ScaledSummary;
  isScaled: boolean;
  onReset: () => void;
}

export function ScalePanel({
  value, onChange, baseUnits, mixerCapacity, onMixerCapacityChange, summary, isScaled, onReset,
}: Props) {
  return (
    <Card className={cn(isScaled ? "border-app bg-app/[0.06]" : "border-border")}>
      <CardContent className="flex flex-wrap items-end gap-x-6 gap-y-3 py-3">
        <div className="flex items-end gap-2">
          <Scale className={cn("mb-2 h-4 w-4", isScaled ? "text-app" : "text-muted-foreground")} />
          <div>
            <Label className="text-xs">Skaler til</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-9 w-28 tabular-nums text-base font-semibold"
              />
              <span className="text-sm text-muted-foreground">enheter</span>
            </div>
          </div>
        </div>

        <div>
          <Label className="text-xs">Eltervolum (g)</Label>
          <Input
            type="number"
            placeholder="valgfritt"
            value={mixerCapacity}
            onChange={(e) => onMixerCapacityChange(e.target.value)}
            className="h-9 w-32 tabular-nums"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Stat label="Faktor" value={`× ${fmtNum(summary.factor, 2)}`} muted={!isScaled} />
          <Stat label="Antall emner" value={summary.unitCount != null ? `${fmtNum(summary.unitCount)} stk` : "—"} />
          <Stat
            label="Deigvekt totalt"
            value={`${fmtG(summary.roundedDoughG)} g`}
            hint={`uavrundet ${fmtNum(summary.exactDoughG, 1)} g`}
          />
          {summary.batchCount != null && (
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-app" />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Satser</div>
                <div className="text-lg font-semibold tabular-nums">
                  {summary.batchCount} × elt
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {isScaled && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-app/50 text-app">
              Skalert visning — ikke lagret
            </Badge>
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Tilbakestill til {fmtNum(baseUnits)}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint, muted }: { label: string; value: string; hint?: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", muted && "text-muted-foreground")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground tabular-nums">{hint}</div>}
    </div>
  );
}
