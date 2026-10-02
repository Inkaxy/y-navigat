import DOMPurify from "dompurify";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RecipeLabelCalculated } from "@/varer/hooks/useRecipeLabel";
import { NUT_ROWS, nutritionValueText } from "./labelShared";

interface Props {
  calculated: RecipeLabelCalculated;
  unitWeight: number | null;
}

/** Beregnet deklarasjon — skrivebeskyttet visning av det NBhub har regnet ut. */
export function CalculatedDeclarationView({ calculated, unitWeight }: Props) {
  const html = calculated.ingredient_declaration ?? "";
  const coverageOk = (calculated.coverage_by_weight_pct ?? 0) >= 90;
  const factor = unitWeight ? unitWeight / 100 : null;
  const contains = calculated.allergens?.contains ?? [];
  const may = calculated.allergens?.may_contain ?? [];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ingrediensdeklarasjon</div>
        {html ? (
          <div
            className="mt-1 rounded-md border bg-muted/30 p-3 text-sm leading-relaxed [&_b]:font-semibold [&_strong]:font-semibold"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
          />
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Ingen ingrediensliste beregnet ennå.</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Allergener er uthevet, og QUID-prosenter står i parentes der de kreves.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inneholder</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {contains.length ? (
              contains.map((a) => (
                <Badge key={a} variant="secondary">
                  {a}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Ingen registrert</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kan inneholde spor av</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {may.length ? (
              may.map((a) => (
                <Badge key={a} variant="outline">
                  {a}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Ingen registrert</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Næringsinnhold</span>
          <Badge variant="outline">Beregnet, ikke analysert</Badge>
          {!coverageOk && <Badge variant="destructive">Kan ikke brukes på emballasje ennå</Badge>}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 text-left font-medium">Per 100 g</th>
              <th className="py-1.5 text-right font-medium">100 g</th>
              {factor && unitWeight && (
                <th className="py-1.5 text-right font-medium">Per porsjon ({Math.round(unitWeight)} g)</th>
              )}
            </tr>
          </thead>
          <tbody>
            {NUT_ROWS.map((r) => (
              <tr key={r.key} className="border-b border-border/50 last:border-0">
                <td className={cn("py-1.5", r.indent && "pl-4 text-muted-foreground")}>
                  {r.indent ? `— ${r.label}` : r.label}
                </td>
                <td className="py-1.5 text-right tabular-nums">{nutritionValueText(r.key, calculated.nutrition_per_100g)}</td>
                {factor && (
                  <td className="py-1.5 text-right tabular-nums">
                    {nutritionValueText(r.key, calculated.nutrition_per_100g, factor)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pt-2 text-xs text-muted-foreground">
          Tallene er <b>beregnet</b> fra råvarenes næringsdata og korrigert for stektap — de er ikke laboratorieanalysert.
        </p>
      </div>
    </div>
  );
}
