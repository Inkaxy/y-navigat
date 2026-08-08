import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/varer/lib/breadscale";

const ROWS = [
  { key: "energy_kj", label: "Energi", unit: "kJ", decimals: 0 },
  { key: "energy_kcal", label: "Energi", unit: "kcal", decimals: 0 },
  { key: "fat_g", label: "Fett", unit: "g", decimals: 1 },
  { key: "saturated_fat_g", label: "— hvorav mettede fettsyrer", unit: "g", decimals: 1, indent: true },
  { key: "carbs_g", label: "Karbohydrater", unit: "g", decimals: 1 },
  { key: "sugars_g", label: "— hvorav sukkerarter", unit: "g", decimals: 1, indent: true },
  { key: "fiber_g", label: "Kostfiber", unit: "g", decimals: 1 },
  { key: "protein_g", label: "Protein", unit: "g", decimals: 1 },
  { key: "salt_g", label: "Salt", unit: "g", decimals: 2 },
] as const;

interface Props {
  per100g: Record<string, number | null> | null;
  /** Emnevekt (g) — gir kolonne per porsjon. */
  unitWeightGrams: number | null;
  coverageOk: boolean;
}

/** Næringsdeklarasjon per 100 g, og per porsjon når emnevekt er satt. */
export function NutritionSection({ per100g, unitWeightGrams, coverageOk }: Props) {
  const factor = unitWeightGrams ? unitWeightGrams / 100 : null;

  return (
    <Card className={cn(!coverageOk && "opacity-60")}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Næringsinnhold</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Beregnet, ikke analysert</Badge>
          {!coverageOk && <Badge variant="destructive">Kan ikke brukes på emballasje ennå</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 text-left font-medium">Per 100 g</th>
              <th className="py-1.5 text-right font-medium">100 g</th>
              {factor && (
                <th className="py-1.5 text-right font-medium">Per porsjon ({Math.round(unitWeightGrams!)} g)</th>
              )}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const v = per100g?.[r.key];
              return (
                <tr key={r.key + r.unit} className="border-b border-border/50 last:border-0">
                  <td className={cn("py-1.5", "indent" in r && r.indent && "pl-4 text-muted-foreground")}>{r.label}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {v == null ? "—" : `${fmtNum(v, r.decimals)} ${r.unit}`}
                  </td>
                  {factor && (
                    <td className="py-1.5 text-right tabular-nums">
                      {v == null ? "—" : `${fmtNum(v * factor, r.decimals)} ${r.unit}`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="pt-2 text-xs text-muted-foreground">
          Tallene er <b>beregnet</b> fra råvarenes næringsdata og korrigert for stektap — de er ikke laboratorieanalysert.
        </p>
      </CardContent>
    </Card>
  );
}
