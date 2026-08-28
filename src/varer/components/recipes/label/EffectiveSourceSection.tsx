import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Calculator, CheckCircle2, ClipboardCopy, Loader2, PencilLine, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { showError } from "@/lib/userError";
import {
  NUTRITION_KEYS,
  buildEffectiveDeclaration,
  declarationDrift,
  parseAllergenSummary,
  pickNutrition,
  stripHtml,
  syncEffectiveDeclarationForRecipe,
  type DeclarationMode,
  type NutritionKey,
  type NutritionPer100g,
  type RecipeLabelSnapshot,
} from "@/varer/lib/effectiveDeclaration";

const NUT_LABELS: Record<NutritionKey, string> = {
  energy_kj: "Energi (kJ)",
  energy_kcal: "Energi (kcal)",
  fat_g: "Fett (g)",
  saturated_fat_g: "— hvorav mettede fettsyrer (g)",
  carbs_g: "Karbohydrater (g)",
  sugars_g: "— hvorav sukkerarter (g)",
  fiber_g: "Kostfiber (g)",
  protein_g: "Protein (g)",
  salt_g: "Salt (g)",
};

export interface RecipeManualDeclaration {
  ingredientText: string;
  contains: string[];
  mayContain: string[];
  nutrition: NutritionPer100g | null;
}

interface Props {
  recipeId: string;
  /** `recipes`-raden. */
  recipe: {
    declaration_mode?: DeclarationMode | null;
    manual_ingredient_declaration?: string | null;
    manual_allergen_summary?: unknown;
    manual_nutrition?: unknown;
  };
  calculated: RecipeLabelSnapshot | null;
  canWrite: boolean;
  /** Antall produkter koblet til oppskriften — brukes i forklaringsteksten. */
  linkedProductCount: number;
}

/** «Hva følger produktet» — velger mellom beregnet og manuell deklarasjon. */
export function EffectiveSourceSection({ recipeId, recipe, calculated, canWrite, linkedProductCount }: Props) {
  const qc = useQueryClient();
  const savedMode: DeclarationMode = (recipe.declaration_mode as DeclarationMode | null) ?? "auto";
  const isManual = savedMode === "manual";

  const savedManual = useMemo<RecipeManualDeclaration>(() => {
    const al = parseAllergenSummary(recipe.manual_allergen_summary);
    return {
      ingredientText: recipe.manual_ingredient_declaration ?? "",
      contains: al.contains,
      mayContain: al.may_contain,
      nutrition: pickNutrition(recipe.manual_nutrition),
    };
  }, [recipe.manual_allergen_summary, recipe.manual_ingredient_declaration, recipe.manual_nutrition]);

  const [ingredient, setIngredient] = useState(savedManual.ingredientText);
  const [contains, setContains] = useState(savedManual.contains.join(", "));
  const [mayContain, setMayContain] = useState(savedManual.mayContain.join(", "));
  const [nutrition, setNutrition] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      NUTRITION_KEYS.map((k) => [k, savedManual.nutrition?.[k] != null ? String(savedManual.nutrition[k]) : ""]),
    ),
  );

  useEffect(() => {
    setIngredient(savedManual.ingredientText);
    setContains(savedManual.contains.join(", "));
    setMayContain(savedManual.mayContain.join(", "));
    setNutrition(
      Object.fromEntries(
        NUTRITION_KEYS.map((k) => [k, savedManual.nutrition?.[k] != null ? String(savedManual.nutrition[k]) : ""]),
      ),
    );
  }, [savedManual]);

  const drift = useMemo(
    () => (isManual ? declarationDrift({ nutrition: savedManual.nutrition, contains: savedManual.contains }, calculated) : null),
    [isManual, savedManual, calculated],
  );

  const afterWrite = async () => {
    const n = await syncEffectiveDeclarationForRecipe(recipeId);
    qc.invalidateQueries({ queryKey: ["recipe-detail", recipeId] });
    return n;
  };

  const setMode = useMutation({
    mutationFn: async (mode: DeclarationMode) => {
      const { error } = await supabase.from("recipes").update({ declaration_mode: mode }).eq("id", recipeId);
      if (error) throw error;
      return afterWrite();
    },
    onSuccess: (n) => toast.success(`Valget er lagret — ${n} produkt${n === 1 ? "" : "er"} oppdatert`),
    onError: (e: unknown) => showError("EffectiveSourceSection", e),
  });

  const saveManual = useMutation({
    mutationFn: async () => {
      const nut: Record<string, number> = {};
      for (const k of NUTRITION_KEYS) {
        const v = nutrition[k];
        if (v !== "" && Number.isFinite(Number(v))) nut[k] = Number(v);
      }
      const { error } = await supabase
        .from("recipes")
        .update({
          manual_ingredient_declaration: ingredient.trim() || null,
          manual_allergen_summary: {
            contains: contains.split(",").map((s) => s.trim()).filter(Boolean),
            may_contain: mayContain.split(",").map((s) => s.trim()).filter(Boolean),
          },
          manual_nutrition: Object.keys(nut).length ? nut : null,
        })
        .eq("id", recipeId);
      if (error) throw error;
      return afterWrite();
    },
    onSuccess: () => toast.success("Manuell deklarasjon lagret"),
    onError: (e: unknown) => showError("EffectiveSourceSection", e),
  });

  function copyFromCalculation() {
    setIngredient(stripHtml(calculated?.ingredient_declaration));
    setContains((calculated?.allergens?.contains ?? []).join(", "));
    setMayContain((calculated?.allergens?.may_contain ?? []).join(", "));
    const calc = pickNutrition(calculated?.nutrition_per_100g);
    setNutrition(
      Object.fromEntries(NUTRITION_KEYS.map((k) => [k, calc?.[k] != null ? String(calc[k]) : ""])),
    );
    toast.success("Feltene er fylt ut fra beregningen — husk å lagre");
  }

  const busy = setMode.isPending || saveManual.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Hva følger produktet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <ModeCard
            active={!isManual}
            disabled={!canWrite || busy}
            icon={<Calculator className="h-4 w-4" />}
            title="Beregnet fra NBOS"
            desc="Ingredienser, allergener og næring hentes fra oppskriftens beregning."
            onClick={() => setMode.mutate("auto")}
          />
          <ModeCard
            active={isManual}
            disabled={!canWrite || busy}
            icon={<PencilLine className="h-4 w-4" />}
            title="Manuell inntasting"
            desc="Du taster inn deklarasjonen selv, og den følger produktet uendret."
            onClick={() => setMode.mutate("manual")}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Valget gjelder {linkedProductCount} koblet{linkedProductCount === 1 ? " produkt" : "e produkter"} — etikett,
          nettbutikk og ordredialog bruker kilden du velger her. Beregningen kjører uansett, så du kan sammenligne til
          den er riktig og deretter bytte.
        </p>

        {drift && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Beregningen har endret seg siden manuell deklarasjon ble lagt inn — sjekk om den manuelle fortsatt
              stemmer. {drift}
            </span>
          </div>
        )}

        <div className={cn("space-y-3 rounded-md border p-3", !isManual && "opacity-60")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Manuell deklarasjon</span>
              <SourceBadge active={isManual} />
            </div>
            {canWrite && (
              <Button variant="outline" size="sm" onClick={copyFromCalculation} disabled={busy}>
                <ClipboardCopy className="mr-1.5 h-4 w-4" /> Kopier fra beregning
              </Button>
            )}
          </div>

          <div>
            <Label className="text-xs">Ingrediensdeklarasjon</Label>
            <Textarea
              rows={3}
              value={ingredient}
              disabled={!canWrite}
              onChange={(e) => setIngredient(e.target.value)}
              placeholder="Hvetemel, vann, salt, gjær …"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Inneholder (kommaseparert)</Label>
              <Input value={contains} disabled={!canWrite} onChange={(e) => setContains(e.target.value)} placeholder="hvete, melk" />
            </div>
            <div>
              <Label className="text-xs">Kan inneholde spor av (kommaseparert)</Label>
              <Input value={mayContain} disabled={!canWrite} onChange={(e) => setMayContain(e.target.value)} placeholder="nøtter, sesam" />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {NUTRITION_KEYS.map((k) => (
              <div key={k}>
                <Label className="text-xs">{NUT_LABELS[k]}</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={nutrition[k] ?? ""}
                  disabled={!canWrite}
                  onChange={(e) => setNutrition((s) => ({ ...s, [k]: e.target.value }))}
                  className="h-9 text-right"
                />
              </div>
            ))}
          </div>

          {canWrite && (
            <div className="flex justify-end">
              <Button onClick={() => saveManual.mutate()} disabled={busy}>
                {saveManual.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Lagre manuell deklarasjon
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Grønt merke på kilden som faktisk følger produktet. */
export function SourceBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="gap-1 border-emerald-600/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">
      <CheckCircle2 className="h-3 w-3" /> Denne følger produktet
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">Følger ikke produktet</Badge>
  );
}

function ModeCard({
  active, disabled, icon, title, desc, onClick,
}: { active: boolean; disabled: boolean; icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70",
        active ? "border-app bg-app/[0.06]" : "hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
        {active && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

/** Eksporteres til bruk i etikett-forhåndsvisning. */
export function buildEffectiveForRecipe(
  recipe: Props["recipe"],
  calculated: RecipeLabelSnapshot | null,
) {
  return buildEffectiveDeclaration(
    {
      id: "",
      product_id: "",
      recipe_id: null,
      declaration_mode: null,
      manual_ingredient_declaration: null,
      manual_nutrition: null,
      manual_allergen_summary: null,
      recipes: {
        declaration_mode: (recipe.declaration_mode as DeclarationMode | null) ?? "auto",
        manual_ingredient_declaration: recipe.manual_ingredient_declaration ?? null,
        manual_nutrition: recipe.manual_nutrition ?? null,
        manual_allergen_summary: recipe.manual_allergen_summary ?? null,
      },
    },
    calculated,
  );
}
