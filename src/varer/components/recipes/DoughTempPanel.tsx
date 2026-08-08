import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Thermometer, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { calcWaterTemp } from "@/varer/lib/bakers";

interface Props {
  targetDoughTemp: number | null;
  frictionFactor: number | null;
  prefermentTemp?: number | null;
  canWrite: boolean;
  onChange: (patch: { target_dough_temp_celsius?: number | null; friction_factor_celsius?: number | null }) => void;
}

export function DoughTempPanel({ targetDoughTemp, frictionFactor, prefermentTemp, canWrite, onChange }: Props) {
  const [roomTemp, setRoomTemp] = useState(21);
  const [flourTemp, setFlourTemp] = useState(21);

  const res = calcWaterTemp({
    targetDoughTemp: targetDoughTemp ?? 24,
    roomTemp,
    flourTemp,
    frictionFactor: frictionFactor ?? 0,
    prefermentTemp: prefermentTemp ?? null,
  });

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
            <Input type="number" step="0.5" className="h-8" value={roomTemp} onChange={(e) => setRoomTemp(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Meltemp (°C)</Label>
            <Input type="number" step="0.5" className="h-8" value={flourTemp} onChange={(e) => setFlourTemp(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Fordeig (°C)</Label>
            <Input className="h-8" value={prefermentTemp ?? "—"} disabled readOnly />
          </div>
        </div>
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            res.feasible ? "border-app/30 bg-app/[0.06]" : "border-warning/40 bg-warning/10",
          )}
        >
          {!res.feasible && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
          <div>
            <div className="font-medium tabular-nums">
              Vanntemperatur: {res.feasible ? `${res.waterTemp.toFixed(1)} °C` : `${res.waterTemp.toFixed(1)} °C (utenfor rekkevidde)`}
            </div>
            <div className="text-xs text-muted-foreground">
              {res.message} Beregnet med {res.factors} faktorer{prefermentTemp != null ? " (inkl. fordeig)" : ""}.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
