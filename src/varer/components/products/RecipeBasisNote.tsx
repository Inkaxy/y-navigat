import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChefHat, ExternalLink, AlertTriangle } from "lucide-react";
import { fmtG } from "@/varer/lib/bakers";
import { useProductRecipeLink } from "@/varer/hooks/useProductRecipeLink";
import { SALES_UNIT_BASIS_LABEL } from "@/varer/lib/recipeLinkBasis";

export type RecipeBasisArea = "produksjon" | "deklarasjon" | "kalkyle" | "pakke" | "varedetaljer";

const AREA_INTRO: Record<RecipeBasisArea, string> = {
  produksjon: "Produksjonsgrunnlaget under kommer fra den koblede oppskriften.",
  deklarasjon: "Deklarasjonen bygger på ingrediensene og underoppskriftene i den koblede oppskriften.",
  kalkyle: "Råvarekostnaden kommer fra den koblede oppskriften, omregnet til varens salgsenhet.",
  pakke: "Vekt- og pakningstallene under er bekreftet på oppskriftskoblingen.",
  varedetaljer: "Vekt og holdbarhet under kommer fra den koblede oppskriften der de finnes.",
};

function nok(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Mangler";
  return `${value.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

/**
 * Liten, lesbar oppsummering av hva den koblede oppskriften tilfører den aktuelle
 * fanen. Viser aldri et tall som mangler grunnlag — da står det «Mangler».
 */
export function RecipeBasisNote({ productId, area }: { productId: string; area: RecipeBasisArea }) {
  const navigate = useNavigate();
  const { bundle, hasRecipe, isLoading } = useProductRecipeLink(productId);

  if (isLoading || !hasRecipe || !bundle.recipe) return null;
  const { recipe, basis } = bundle;

  const facts: { label: string; value: string; origin: string }[] = [];

  if (area === "produksjon") {
    facts.push(
      { label: "Deigvekt", value: bundle.totalDoughG ? `${fmtG(bundle.totalDoughG)} g` : "Mangler", origin: "Beregnet" },
      { label: "Antall emner", value: bundle.unitCount != null ? `${bundle.unitCount} stk` : "Mangler", origin: "Fra oppskrift" },
      { label: "Stykkvekt", value: basis.weightPerUnitG ? `${fmtG(basis.weightPerUnitG)} g` : "Mangler", origin: "Beregnet" },
      {
        label: "Steking",
        value:
          recipe.bake_temp_celsius != null || recipe.bake_time_minutes != null
            ? `${recipe.bake_temp_celsius ?? "—"} °C / ${recipe.bake_time_minutes ?? "—"} min`
            : "Mangler",
        origin: "Fra oppskrift",
      },
    );
  } else if (area === "deklarasjon") {
    facts.push(
      { label: "Ingredienser", value: `${bundle.lines.length}`, origin: "Fra oppskrift" },
      {
        label: "Underoppskrifter",
        value: `${bundle.lines.filter((l) => l.sub_product_id || l._rm?.produced_by_recipe_id).length}`,
        origin: "Fra oppskrift",
      },
      {
        label: "Netto vekt per salgsenhet",
        value: basis.weightPerSalesUnitG ? `${fmtG(basis.weightPerSalesUnitG)} g` : "Mangler",
        origin: "Beregnet",
      },
    );
  } else if (area === "kalkyle") {
    facts.push(
      { label: "Råvarekost per stk", value: nok(basis.costPerUnit), origin: "Beregnet" },
      { label: "Råvarekost per salgsenhet", value: nok(basis.costPerSalesUnit), origin: "Beregnet" },
      {
        label: "Enheter per salgsenhet",
        value: basis.unitsPerSalesUnit != null ? `${basis.unitsPerSalesUnit}` : "Ikke bekreftet",
        origin: "Bekreftet på koblingen",
      },
    );
  } else if (area === "pakke") {
    facts.push(
      {
        label: "Enheter per salgsenhet",
        value: basis.unitsPerSalesUnit != null ? `${basis.unitsPerSalesUnit}` : "Ikke bekreftet",
        origin: "Bekreftet på koblingen",
      },
      {
        label: "Vekt per salgsenhet",
        value: basis.weightPerSalesUnitG ? `${fmtG(basis.weightPerSalesUnitG)} g` : "Mangler",
        origin: "Beregnet",
      },
    );
  } else {
    facts.push(
      { label: "Stykkvekt", value: basis.weightPerUnitG ? `${fmtG(basis.weightPerUnitG)} g` : "Mangler", origin: "Beregnet" },
      {
        label: "Holdbarhet",
        value: recipe.shelf_life_days != null ? `${recipe.shelf_life_days} dager` : "Mangler",
        origin: "Fra oppskrift",
      },
    );
  }

  return (
    <Card className="border-app/30 bg-app/[0.03]">
      <CardContent className="space-y-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChefHat className="h-4 w-4 shrink-0 text-app" />
          <span className="text-sm font-medium">{recipe.name || "Koblet oppskrift"}</span>
          {basis.basis ? (
            <Badge variant="outline" className="text-[10px]">
              {SALES_UNIT_BASIS_LABEL[basis.basis]}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">
              Salgsenhet ikke bekreftet
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => navigate(`/varer/oppskrifter/${recipe.id}`)}
          >
            Åpne oppskrift <ExternalLink className="ml-1 h-3 w-3" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{AREA_INTRO[area]}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</div>
              <div className="text-sm font-semibold tabular-nums">{f.value}</div>
              <div className="text-[10px] text-muted-foreground">{f.origin}</div>
            </div>
          ))}
        </div>
        {basis.missing.length > 0 && (
          <div className="flex gap-2 rounded-md bg-muted/60 p-2 text-[11px]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <ul className="space-y-0.5">
              {basis.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
