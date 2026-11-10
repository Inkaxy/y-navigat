import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RecipeSection } from "@/varer/components/recipes/editor/RecipeSections";
import { RECIPE_STATUS_OPTIONS } from "@/varer/lib/bakers";
import { RECIPE_DEPARTMENT_LABEL, RECIPE_DEPARTMENTS } from "@/varer/lib/departments";
import type { CompositeRawMaterial } from "@/varer/components/recipes/SaveAsRawMaterialDialog";
import type { HeaderState, RecipeEditorState } from "@/varer/hooks/useRecipeEditor";

/**
 * «Oppskriftsinfo og vekt» på fanen Oppskrift. Flyttet uendret fra
 * oppskriftssiden; bildet ligger nå på fanen Fremgangsmåte.
 */
export function RecipeInfoSection({
  header,
  patchHeader,
  editable,
  canWrite,
  composite,
  repricing,
  onUpdateCompositePrice,
  isBaseRecipe,
  onToggleBaseRecipe,
  usedIn,
  onOpenRecipe,
  doughGramsTotal,
}: {
  header: RecipeEditorState["header"];
  patchHeader: (patch: Partial<HeaderState>) => void;
  editable: boolean;
  canWrite: boolean;
  composite: CompositeRawMaterial | null;
  repricing: boolean;
  onUpdateCompositePrice: () => void;
  isBaseRecipe: boolean;
  onToggleBaseRecipe: (on: boolean) => void;
  usedIn: { id: string; name: string }[];
  onOpenRecipe: (id: string) => void;
  doughGramsTotal: number;
}) {
  return (
    <RecipeSection id="seksjon-info" title="Oppskriftsinfo og vekt">
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Oppskriftsinfo</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {composite && (
        <div className="col-span-full flex flex-wrap items-start gap-4">
          {(
            <div className="flex items-center gap-2 rounded-md border border-app/40 bg-app/[0.06] px-3 py-2">
              <Badge variant="outline" className="border-app/50 text-app">Halvfabrikat</Badge>
              <span className="text-sm">
                {composite.name}
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                  {composite.current_cost_price != null
                    ? `${Number(composite.current_cost_price).toFixed(2).replace(".", ",")} kr/kg`
                    : "ingen pris"}
                </span>
              </span>
              {canWrite && (
                <Button size="sm" variant="ghost" disabled={repricing} onClick={onUpdateCompositePrice}>
                  {repricing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Oppdater pris
                </Button>
              )}
            </div>
          )}
        </div>
        )}

        {/* Grunnoppskrift — gjør oppskriften valgbar som ingredienslinje andre steder. */}
        <div className="col-span-full rounded-md border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              id="base-recipe"
              checked={isBaseRecipe}
              disabled={!editable}
              onCheckedChange={onToggleBaseRecipe}
            />
            <Label htmlFor="base-recipe" className="cursor-pointer text-sm font-medium">
              Grunnoppskrift — kan brukes som linje i andre oppskrifter
            </Label>
            {composite ? (
              <Badge variant="outline" className="border-app/50 text-app">Koblet råvare: {composite.name}</Badge>
            ) : isBaseRecipe ? (
              <Badge variant="outline" className="border-warning/50 text-warning">Ingen råvare koblet ennå</Badge>
            ) : null}
          </div>
          {composite && (
            <p className="mt-2 text-xs text-muted-foreground">
              {usedIn.length === 0
                ? "Brukes ikke i andre oppskrifter ennå."
                : `Brukes i ${usedIn.length} oppskrift${usedIn.length === 1 ? "" : "er"}:`}
              {usedIn.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="ml-2 underline underline-offset-2 hover:text-foreground"
                  onClick={() => onOpenRecipe(u.id)}
                >
                  {u.name}
                </button>
              ))}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <Label className="text-xs">Navn</Label>
          <Input value={header.name ?? ""} disabled={!editable} onChange={(e) => patchHeader({ name: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Kategori</Label>
          <Input value={header.category ?? ""} disabled={!editable} placeholder="f.eks. Surdeigsbrød"
            onChange={(e) => patchHeader({ category: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Avdeling</Label>
          <select
            value={header.department ?? ""} disabled={!editable}
            onChange={(e) => patchHeader({ department: e.target.value })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Ingen</option>
            {RECIPE_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{RECIPE_DEPARTMENT_LABEL[d]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <select
            value={header.status ?? "draft"} disabled={!editable}
            onChange={(e) => patchHeader({ status: e.target.value })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {RECIPE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="col-span-full mt-1 border-t pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vekt og utbytte
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Deigemnevekt (g)</Label>
              <Input type="number" value={header.dough_piece_grams ?? ""} disabled={!editable}
                onChange={(e) => patchHeader({ dough_piece_grams: e.target.value })} />
              <p className="mt-1 text-xs text-muted-foreground">
                Vekten på deigemnet før steking. Denne styrer kalkylen.
              </p>
            </div>
            <div>
              <Label className="text-xs">Deigsvinn (%)</Label>
              <Input type="number" value={header.dough_waste_pct ?? ""} disabled={!editable}
                onChange={(e) => patchHeader({ dough_waste_pct: e.target.value })} />
              <p className="mt-1 text-xs text-muted-foreground">
                Rester, avskjær, feilvekt og vraket bakst.
              </p>
            </div>
            <div>
              <Label className="text-xs">Ferdigvekt (g)</Label>
              <Input type="number" value={header.finished_weight_grams ?? ""} disabled={!editable}
                onChange={(e) => patchHeader({ finished_weight_grams: e.target.value })} />
              <p className="mt-1 text-xs text-muted-foreground">
                Vekt per stk etter steking — ganges med antall for deklarasjon og grovhet. Brukes ikke til kostprisen.
              </p>
            </div>
          </div>
          <YieldPreview
            doughGrams={doughGramsTotal}
            doughPieceGrams={Number(header.dough_piece_grams) || null}
            doughWastePct={Number(header.dough_waste_pct) || 0}
            finishedWeightGrams={Number(header.finished_weight_grams) || null}
          />
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={!!header.measured_per_kg}
              disabled={!editable}
              onChange={(e) => patchHeader({ measured_per_kg: e.target.checked })}
            />
            <span>
              Oppskriften er målt per kg
              <span className="block text-xs font-normal text-muted-foreground">
                For halvfabrikat som deig, krem og fyll. Sett deigemnevekt til 1000 g.
              </span>
            </span>
          </label>
        </div>
        <div>
          <Label className="text-xs">Antall per batch</Label>
          <Input type="number" value={header.units_per_batch ?? ""} disabled={!editable}
            onChange={(e) => patchHeader({ units_per_batch: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Autolyse (min)</Label>
          <Input type="number" value={header.autolyse_minutes ?? ""} disabled={!editable}
            onChange={(e) => patchHeader({ autolyse_minutes: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Elting 1. gir (min)</Label>
            <Input type="number" value={header.mixing_speed1_minutes ?? ""} disabled={!editable}
              onChange={(e) => patchHeader({ mixing_speed1_minutes: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">2. gir (min)</Label>
            <Input type="number" value={header.mixing_speed2_minutes ?? ""} disabled={!editable}
              onChange={(e) => patchHeader({ mixing_speed2_minutes: e.target.value })} />
          </div>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Label className="text-xs">Beskrivelse</Label>
          <Textarea rows={2} value={header.description ?? ""} disabled={!editable}
            onChange={(e) => patchHeader({ description: e.target.value })} />
        </div>
      </CardContent>
    </Card>

    </RecipeSection>
  );
}

/** Forhåndsvisning av utbytte og steketap. Kun visning — kalkylen kommer fra product_cost. */
function YieldPreview({
  doughGrams,
  doughPieceGrams,
  doughWastePct,
  finishedWeightGrams,
}: {
  doughGrams: number;
  doughPieceGrams: number | null;
  doughWastePct: number;
  finishedWeightGrams: number | null;
}) {
  const nb = (n: number, d = 1) =>
    n.toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d });

  if (!doughPieceGrams || doughPieceGrams <= 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        Sett deigemnevekt for å beregne antall enheter
      </p>
    );
  }

  const units = (doughGrams * (1 - (doughWastePct || 0) / 100)) / doughPieceGrams;

  let bake: { pct: number; tone: "grey" | "warn" | "bad" } | null = null;
  if (finishedWeightGrams && finishedWeightGrams > 0) {
    const pct = (1 - finishedWeightGrams / doughPieceGrams) * 100;
    bake = {
      pct,
      tone: finishedWeightGrams > doughPieceGrams ? "bad" : pct < 3 || pct > 25 ? "warn" : "grey",
    };
  }

  return (
    <div className="mt-3 space-y-1">
      <p className="text-sm text-muted-foreground">
        {nb(doughGrams, 0)} g deig · {nb(doughWastePct || 0, 0)} % svinn · {nb(doughPieceGrams, 0)} g per emne →{" "}
        <span className="font-semibold text-foreground">{nb(units, 1)} enheter</span>
      </p>
      {bake && bake.tone === "grey" && (
        <p className="text-sm text-muted-foreground">
          Steketap <span className="font-semibold text-foreground">{nb(bake.pct, 1)} %</span>
        </p>
      )}
      {bake && bake.tone === "warn" && (
        <p className="flex items-center gap-1.5 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Steketap <span className="font-semibold">{nb(bake.pct, 1)} %</span> — Sjekk vektene, dette ser ikke ut som et vanlig steketap
        </p>
      )}
      {bake && bake.tone === "bad" && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Ferdigvekt kan ikke være høyere enn deigemnevekt
        </p>
      )}
    </div>
  );
}
