import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtG, fmtPercent, type BakersTotals } from "@/varer/lib/bakers";
import type { RecipeCostTotals } from "@/varer/lib/recipeCost";

const nok = (v: number) =>
  `${v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;

export interface RecipeMargin {
  /** Faktisk dekningsgrad i prosent. */
  marginPct: number | null;
  /** Målsatt dekningsgrad i prosent. */
  targetPct: number | null;
}

export function RecipeStatsBar({
  totals,
  cost,
  margin,
  prefermentedFlourPct,
  className,
}: {
  totals: BakersTotals;
  /** Kost for oppskriften. Utelates når kost ikke skal vises. */
  cost?: RecipeCostTotals;
  margin?: RecipeMargin;
  /** Sum av `prefermentedFlourPct` fra `computePartSummary` over fordeig-delene. */
  prefermentedFlourPct?: number | null;
  className?: string;
}) {
  const items: { label: string; value: string; hint?: string; tone?: "app" | "warning" }[] = [
    { label: "Total melvekt", value: `${fmtG(totals.totalFlourG)} g`, hint: "100 %" },
    { label: "Hydrering", value: fmtPercent(totals.hydrationPct), tone: "app" },
    { label: "Salt", value: fmtPercent(totals.saltPct) },
    { label: "Gjær / surdeig", value: fmtPercent(totals.leavenPct) },
    ...(prefermentedFlourPct != null
      ? [{ label: "Fordeig %", value: fmtPercent(prefermentedFlourPct) }]
      : []),
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

  if (cost) {
    items.push(
      {
        label: "Råvarekost",
        value: cost.incomplete ? `Minst ${nok(cost.totalCost)}` : nok(cost.totalCost),
        hint: cost.incomplete
          ? `Ufullstendig — ${cost.missing.length} linje${cost.missing.length === 1 ? "" : "r"} mangler grunnlag`
          : undefined,
        tone: cost.incomplete ? "warning" : undefined,
      },
      {
        label: "Kost per kg",
        value: cost.costPerKg != null ? `${nok(cost.costPerKg)}/kg` : "Ukjent",
        hint: cost.costPerKg == null ? "Kan ikke beregnes før alle linjer har kost og vekt" : undefined,
      },
      {
        label: "Kost per emne",
        value: cost.costPerUnit != null ? nok(cost.costPerUnit) : "Ukjent",
        hint: cost.costPerUnit == null ? "Trenger antall emner og full kost" : undefined,
      },
    );
  }

  if (margin && margin.marginPct != null) {
    const under = margin.targetPct != null && margin.marginPct < margin.targetPct;
    items.push({
      label: "Dekningsgrad",
      value: `${margin.marginPct.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %`,
      hint: margin.targetPct != null ? `Mål ${margin.targetPct.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %` : undefined,
      tone: under ? "warning" : "app",
    });
  }

  return (
    <Card className={cn("sticky top-0 z-10 border-app/30 bg-app/[0.04]", className)}>
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 py-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.label}</div>
            <div
              className={cn(
                "text-lg font-semibold tabular-nums",
                it.tone === "app" && "text-app",
                it.tone === "warning" && "text-warning",
              )}
            >
              {it.value}
            </div>
            {it.hint && <div className="text-[11px] text-muted-foreground">{it.hint}</div>}
          </div>
        ))}
        {cost?.incomplete && (
          <Alert className="col-span-2 sm:col-span-3 lg:col-span-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">Kostnaden er ufullstendig.</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {cost.missing.slice(0, 5).map((m, i) => (
                  <li key={i}>
                    {m.name}: {m.reason}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
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
