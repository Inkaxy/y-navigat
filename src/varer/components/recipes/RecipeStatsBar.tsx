import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtG, fmtPercent, type BakersTotals } from "@/varer/lib/bakers";

export function RecipeStatsBar({ totals, className }: { totals: BakersTotals; className?: string }) {
  const items: { label: string; value: string; hint?: string; tone?: "app" }[] = [
    { label: "Total melvekt", value: `${fmtG(totals.totalFlourG)} g`, hint: "100 %" },
    { label: "Hydrering", value: fmtPercent(totals.hydrationPct), tone: "app" },
    { label: "Salt", value: fmtPercent(totals.saltPct) },
    { label: "Gjær / surdeig", value: fmtPercent(totals.leavenPct) },
    {
      label: "Total deigvekt",
      value: totals.incomplete ? `Minst ${fmtG(totals.totalDoughG)} g` : `${fmtG(totals.totalDoughG)} g`,
      hint: totals.incomplete ? "Ufullstendig — noen linjer mangler vekt" : undefined,
    },
    {
      label: "Antall emner",
      value: totals.unitCount != null ? `${totals.unitCount} stk` : totals.incomplete ? "Ukjent" : "—",
      hint: totals.incomplete
        ? "Kan ikke beregnes før alle mengder er kjent"
        : totals.doughPerUnitG
          ? `${fmtG(totals.doughPerUnitG)} g/stk`
          : "Sett vekt per enhet",
    },
  ];

  return (
    <Card className={cn("border-app/30 bg-app/[0.04]", className)}>
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 py-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.label}</div>
            <div className={cn("text-lg font-semibold tabular-nums", it.tone === "app" && "text-app")}>{it.value}</div>
            {it.hint && <div className="text-[11px] text-muted-foreground">{it.hint}</div>}
          </div>
        ))}
        {totals.incomplete && (
          <Alert variant="destructive" className="col-span-2 sm:col-span-3 lg:col-span-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">Deigvekten er ufullstendig og kan ikke brukes som produksjonsvekt.</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {totals.warnings.slice(0, 5).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function HydrationBadge({ pct }: { pct: number }) {
  return <Badge variant="outline" className="tabular-nums">{fmtPercent(pct)} hydrering</Badge>;
}
