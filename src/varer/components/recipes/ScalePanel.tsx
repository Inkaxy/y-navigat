import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Scale, RotateCcw, Layers, AlertTriangle, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtG, fmtNum } from "@/varer/lib/bakers";
import {
  ROUNDING_OPTIONS, SCALE_MODE_LABEL, type RoundingStep, type ScaleMode, type ScaleResult,
} from "@/varer/lib/scaling";

const MODES: ScaleMode[] = ["units", "flour", "dough", "batches"];

const TARGET_LABEL: Record<ScaleMode, string> = {
  units: "Antall emner",
  flour: "Melvekt (g)",
  dough: "Total deigvekt (g)",
  batches: "Maks deig per elt (kg)",
};

interface Props {
  mode: ScaleMode;
  onModeChange: (mode: ScaleMode) => void;
  /** Måltall som fritekst, så feltet kan tømmes mens man skriver. */
  target: string;
  onTargetChange: (v: string) => void;
  rounding: RoundingStep;
  onRoundingChange: (v: RoundingStep) => void;
  /** Ekstra svinn i prosent, som fritekst. */
  waste: string;
  onWasteChange: (v: string) => void;
  result: ScaleResult;
  baseUnits: number;
  isScaled: boolean;
  onReset: () => void;
  /** Lagrer den skalerte utgaven som en ny oppskrift. */
  onSaveAsNew?: () => void;
  savingAsNew?: boolean;
}

export function ScalePanel({
  mode, onModeChange, target, onTargetChange, rounding, onRoundingChange, waste, onWasteChange,
  result, baseUnits, isScaled, onReset, onSaveAsNew, savingAsNew,
}: Props) {
  const perBatchVisible = result.perBatch.length > 0 && (isScaled || result.batchCount > 1);

  return (
    <Card className={cn(isScaled || result.batchCount > 1 ? "border-app bg-app/[0.06]" : "border-border")}>
      <CardContent className="space-y-3 py-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex items-end gap-2">
            <Scale className={cn("mb-2 h-4 w-4", isScaled ? "text-app" : "text-muted-foreground")} />
            <div>
              <Label className="text-xs">Skaler etter</Label>
              <select
                value={mode}
                onChange={(e) => onModeChange(e.target.value as ScaleMode)}
                className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Skaleringsmodus"
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>{SCALE_MODE_LABEL[m]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label className="text-xs">{TARGET_LABEL[mode]}</Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={target}
              onChange={(e) => onTargetChange(e.target.value)}
              className="h-9 w-32 tabular-nums text-base font-semibold"
            />
          </div>

          <div>
            <Label className="text-xs">Avrunding</Label>
            <select
              value={String(rounding)}
              onChange={(e) => onRoundingChange(Number(e.target.value) as RoundingStep)}
              className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Avrunding"
            >
              {ROUNDING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs">Ekstra svinn (%)</Label>
            <Input
              type="number"
              min={0}
              step="any"
              placeholder="0"
              value={waste}
              onChange={(e) => onWasteChange(e.target.value)}
              className="h-9 w-24 tabular-nums"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Stat label="Faktor" value={`× ${fmtNum(result.factor, 2)}`} muted={!isScaled} />
            <Stat
              label="Antall emner"
              value={result.unitCount != null ? `${fmtNum(result.unitCount)} stk` : result.incomplete ? "Ukjent" : "—"}
              hint={result.incomplete ? "Noen mengder mangler vekt" : undefined}
            />
            <Stat
              label="Deigvekt totalt"
              value={`${fmtG(result.totalDoughG)} g`}
              hint={result.incomplete ? "Ufullstendig — ikke en produksjonsvekt" : undefined}
            />
            {result.batchCount > 1 && (
              <div className="flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-app" />
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Satser</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {result.batchCount} × {fmtG(result.batchDoughG)} g
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
              {onSaveAsNew && (
                <Button variant="outline" size="sm" onClick={onSaveAsNew} disabled={savingAsNew}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Bruk som ny oppskrift
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onReset}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Tilbakestill til {fmtNum(baseUnits)}
              </Button>
            </div>
          )}
        </div>

        {result.warnings.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{result.warnings.slice(0, 3).join(" · ")}</span>
          </p>
        )}

        {perBatchVisible && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Innveiing per sats</caption>
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Ingrediens</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Per sats</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {result.perBatch.map((l) => (
                  <tr key={l.lineId} className="border-t border-border/60">
                    <td className="px-2 py-1">{l.name}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {l.grams != null ? `${fmtG(l.grams)} g` : `${fmtNum(l.quantity, 3)} ${l.unit}`}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {l.percent != null ? `${fmtNum(l.percent, 1)} %` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
