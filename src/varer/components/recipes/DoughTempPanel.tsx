import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Thermometer, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { calcWaterTemp } from "@/varer/lib/bakers";

interface Props {
  targetDoughTemp: number | null;
  frictionFactor: number | null;
  /** Fordeigens temperatur — `recipes.preferment_temp_celsius`. */
  prefermentTemp: number | null;
  /** Fordeigens vekt i gram, fra `computePartSummary` over delene med `part_type = 'preferment'`. */
  prefermentGrams: number;
  /** Samlet deigvekt i gram — nevneren for fordeigens andel av deigen. */
  totalDoughG: number;
  canWrite: boolean;
  /** Rom- og meltemperatur eies av siden, slik at PDF-en får de samme tallene. */
  roomTemp: number;
  flourTemp: number;
  onRoomTempChange: (v: number) => void;
  onFlourTempChange: (v: number) => void;
  onPrefermentTempChange: (v: number | null) => void;
  onChange: (patch: { target_dough_temp_celsius?: number | null; friction_factor_celsius?: number | null }) => void;
}

export function DoughTempPanel({
  targetDoughTemp,
  frictionFactor,
  prefermentTemp,
  prefermentGrams,
  totalDoughG,
  canWrite,
  roomTemp,
  flourTemp,
  onRoomTempChange,
  onFlourTempChange,
  onPrefermentTempChange,
  onChange,
}: Props) {
  const hasPreferment = prefermentTemp != null && prefermentGrams > 0 && totalDoughG > 0;
  const res = calcWaterTemp({
    targetDoughTempC: targetDoughTemp ?? 24,
    roomTempC: roomTemp,
    flourTempC: flourTemp,
    frictionC: frictionFactor ?? 0,
    preferment: hasPreferment ? { tempC: prefermentTemp as number, grams: prefermentGrams } : null,
    totalDoughG,
  });

  const waterTempC = res?.waterTempC ?? null;
  const feasible = waterTempC != null && waterTempC >= 0 && waterTempC <= 60;
  const message =
    waterTempC == null
      ? "Fyll inn ønsket deigtemperatur, romtemp, meltemp og friksjonsfaktor for å beregne vanntemperaturen."
      : feasible
        ? `Bruk vann på ${waterTempC.toFixed(1)} °C for å treffe ${Number(targetDoughTemp ?? 24).toFixed(1)} °C deigtemperatur.`
        : waterTempC < 0
          ? "Vanntemperaturen blir under 0 °C — ikke praktisk oppnåelig. Bruk isvann og senk romtemperaturen, eller juster ønsket deigtemperatur."
          : "Vanntemperaturen blir over 60 °C — ikke praktisk oppnåelig. Varm opp melet eller rommet, eller juster ønsket deigtemperatur.";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Thermometer className="h-4 w-4 text-app" /> Deigtemperatur
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div>
            <Label className="text-xs">Ønsket deigtemp (°C)</Label>
            <Input type="number" step="0.5" className="h-8" disabled={!canWrite}
              value={targetDoughTemp ?? ""}
              onChange={(e) => onChange({ target_dough_temp_celsius: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <Label className="text-xs">Friksjonsfaktor</Label>
            <Input type="number" step="0.5" className="h-8" disabled={!canWrite}
              value={frictionFactor ?? ""}
              onChange={(e) => onChange({ friction_factor_celsius: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <Label className="text-xs">Romtemp (°C)</Label>
            <Input type="number" step="0.5" className="h-8" value={roomTemp} onChange={(e) => onRoomTempChange(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Meltemp (°C)</Label>
            <Input type="number" step="0.5" className="h-8" value={flourTemp} onChange={(e) => onFlourTempChange(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Fordeig (°C)</Label>
            <Input type="number" step="0.5" className="h-8" disabled={!canWrite}
              value={prefermentTemp ?? ""}
              onChange={(e) => onPrefermentTempChange(e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            feasible || waterTempC == null ? "border-app/30 bg-app/[0.06]" : "border-warning/40 bg-warning/10",
          )}
        >
          {waterTempC != null && !feasible && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
          <div>
            <div className="font-medium tabular-nums">
              Vanntemperatur: {waterTempC != null ? `${waterTempC.toFixed(1)} °C${feasible ? "" : " (utenfor rekkevidde)"}` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {message} {hasPreferment ? "Beregnet med fordeigens vektede andel av deigen." : "Beregnet uten fordeig."}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
