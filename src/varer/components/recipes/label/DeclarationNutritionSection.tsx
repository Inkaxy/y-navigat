import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ClipboardCopy, Copy, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { showError } from "@/lib/userError";
import { fmtNum } from "@/varer/lib/breadscale";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/varer/components/products/detail/UnsavedChangesDialog";
import { useUserDisplayName, type RecipeLabelCalculated } from "@/varer/hooks/useRecipeLabel";
import {
  NUTRITION_KEYS,
  declarationDrift,
  parseAllergenSummary,
  pickNutrition,
  stripHtml,
  syncEffectiveDeclarationForRecipe,
  type DeclarationMode,
  type NutritionPer100g,
  type RecipeLabelSnapshot,
} from "@/varer/lib/effectiveDeclaration";
import { DiffNote, NUT_ROWS, SourceColumn, SourceSegmented, formatDateTimeNb } from "./labelShared";

const NUT_LABELS: Record<string, string> = {
  energy_kj: "Energi (kJ)",
  energy_kcal: "Energi (kcal)",
  fat_g: "Fett (g)",
  saturated_fat_g: "— mettede fettsyrer (g)",
  carbs_g: "Karbohydrater (g)",
  sugars_g: "— sukkerarter (g)",
  fiber_g: "Kostfiber (g)",
  protein_g: "Protein (g)",
  salt_g: "Salt (g)",
};

interface Props {
  recipeId: string;
  recipe: {
    declaration_mode?: DeclarationMode | null;
    manual_ingredient_declaration?: string | null;
    manual_allergen_summary?: unknown;
    manual_nutrition?: unknown;
    unit_weight_grams?: number | null;
    declaration_updated_at?: string | null;
    declaration_updated_by?: string | null;
  };
  calculated: RecipeLabelCalculated | null;
  canWrite: boolean;
  linkedProductCount: number;
  computing: boolean;
  onRecompute: () => void;
}

/** Deklarasjon & næringsinnhold — beregnet og manuell side om side, én bryter. */
export function DeclarationNutritionSection({
  recipeId,
  recipe,
  calculated,
  canWrite,
  linkedProductCount,
  computing,
  onRecompute,
}: Props) {
  const qc = useQueryClient();
  const mode: DeclarationMode = (recipe.declaration_mode as DeclarationMode | null) ?? "auto";
  const manualActive = mode === "manual";

  const saved = useMemo(() => {
    const al = parseAllergenSummary(recipe.manual_allergen_summary);
    return {
      ingredientText: recipe.manual_ingredient_declaration ?? "",
      contains: al.contains.join(", "),
      mayContain: al.may_contain.join(", "),
      nutrition: Object.fromEntries(
        NUTRITION_KEYS.map((k) => {
          const n = pickNutrition(recipe.manual_nutrition);
          return [k, n?.[k] != null ? String(n[k]) : ""];
        }),
      ) as Record<string, string>,
    };
  }, [recipe.manual_allergen_summary, recipe.manual_ingredient_declaration, recipe.manual_nutrition]);

  const [form, setForm] = useState(saved);
  const dirtyRef = useRef(false);

  // Dirty-guard: refetch av oppskriften skal ALDRI nullstille ulagrede endringer.
  useEffect(() => {
    if (!dirtyRef.current) setForm(saved);
  }, [saved]);

  const dirty =
    form.ingredientText !== saved.ingredientText ||
    form.contains !== saved.contains ||
    form.mayContain !== saved.mayContain ||
    NUTRITION_KEYS.some((k) => (form.nutrition[k] ?? "") !== (saved.nutrition[k] ?? ""));
  dirtyRef.current = dirty;
  const unsavedGuard = useUnsavedChangesGuard(dirty && canWrite);

  const setField = <K extends "ingredientText" | "contains" | "mayContain">(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setNut = (k: string, v: string) => setForm((f) => ({ ...f, nutrition: { ...f.nutrition, [k]: v } }));

  const afterWrite = async () => {
    const n = await syncEffectiveDeclarationForRecipe(recipeId);
    qc.invalidateQueries({ queryKey: ["recipe-detail", recipeId] });
    qc.invalidateQueries({ queryKey: ["recipe-linked-products"] });
    return n;
  };

  const setMode = useMutation({
    mutationFn: async (m: DeclarationMode) => {
      const { error } = await supabase.from("recipes").update({ declaration_mode: m }).eq("id", recipeId);
      if (error) throw error;
      return afterWrite();
    },
    onSuccess: (n) => toast.success(`Valget er lagret — ${n} produkt${n === 1 ? "" : "er"} oppdatert`),
    onError: (e: unknown) => showError("DeclarationNutritionSection", e),
  });

  const saveManual = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const nut: Record<string, number> = {};
      for (const k of NUTRITION_KEYS) {
        const v = form.nutrition[k];
        if (v !== "" && Number.isFinite(Number(String(v).replace(",", ".")))) {
          nut[k] = Number(String(v).replace(",", "."));
        }
      }
      const { error } = await supabase
        .from("recipes")
        .update({
          manual_ingredient_declaration: form.ingredientText.trim() || null,
          manual_allergen_summary: {
            contains: form.contains.split(",").map((s) => s.trim()).filter(Boolean),
            may_contain: form.mayContain.split(",").map((s) => s.trim()).filter(Boolean),
          },
          manual_nutrition: Object.keys(nut).length ? nut : null,
          declaration_updated_at: new Date().toISOString(),
          declaration_updated_by: u.user?.id ?? null,
        } as never)
        .eq("id", recipeId);
      if (error) throw error;
      dirtyRef.current = false;
      // Normaliser skjemaet til det som faktisk ble lagret, så «Ulagrede endringer» forsvinner.
      const normalized = {
        ingredientText: form.ingredientText.trim(),
        contains: form.contains.split(",").map((s) => s.trim()).filter(Boolean).join(", "),
        mayContain: form.mayContain.split(",").map((s) => s.trim()).filter(Boolean).join(", "),
        nutrition: Object.fromEntries(
          NUTRITION_KEYS.map((k) => [k, nut[k] != null ? String(nut[k]) : ""]),
        ) as Record<string, string>,
      };
      await afterWrite();
      return normalized;
    },
    onSuccess: (normalized) => {
      setForm(normalized);
      dirtyRef.current = false;
      toast.success("Manuell deklarasjon lagret");
    },
    onError: (e: unknown) => showError("DeclarationNutritionSection", e),
  });

  const busy = setMode.isPending || saveManual.isPending;
  const updatedByName = useUserDisplayName(recipe.declaration_updated_by ?? null).data;

  const html = calculated?.ingredient_declaration ?? "";
  const plain = stripHtml(html);
  const coveragePct = calculated?.coverage_by_weight_pct ?? null;
  const coverageOk = (coveragePct ?? 0) >= 90;
  const unitWeight = recipe.unit_weight_grams ?? null;
  const factor = unitWeight ? unitWeight / 100 : null;

  const savedManualNutrition = pickNutrition(recipe.manual_nutrition) as NutritionPer100g | null;
  const drift = declarationDrift(
    { nutrition: savedManualNutrition, contains: parseAllergenSummary(recipe.manual_allergen_summary).contains },
    (calculated ?? null) as RecipeLabelSnapshot | null,
  );

  function copyFromCalculation() {
    const calc = pickNutrition(calculated?.nutrition_per_100g);
    setForm({
      ingredientText: plain,
      contains: (calculated?.allergens?.contains ?? []).join(", "),
      mayContain: (calculated?.allergens?.may_contain ?? []).join(", "),
      nutrition: Object.fromEntries(
        NUTRITION_KEYS.map((k) => [k, calc?.[k] != null ? String(calc[k]) : ""]),
      ) as Record<string, string>,
    });
    toast.success("Feltene er fylt ut fra beregningen — husk å lagre");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Deklarasjon &amp; næringsinnhold</CardTitle>
        <SourceSegmented
          value={manualActive ? "manual" : "auto"}
          disabled={!canWrite || busy}
          onChange={(v) => setMode.mutate(v === "manual" ? "manual" : "auto")}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Gjelder {linkedProductCount} koblede produkter — etikett, nettbutikk og ordredialog. Beregningen kjører
          uansett, så du kan sammenligne til den er riktig og deretter bytte.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---------- Beregnet ---------- */}
          <SourceColumn
            title="Beregnet av NBhub"
            active={!manualActive}
            actions={
              plain ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(plain);
                    toast.success("Ingredienslisten er kopiert");
                  }}
                >
                  <Copy className="mr-1.5 h-4 w-4" /> Kopier tekst
                </Button>
              ) : null
            }
          >
            {!calculated ? (
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">Ikke beregnet ennå.</p>
                {canWrite && (
                  <Button onClick={onRecompute} disabled={computing}>
                    {computing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Beregn merkedata
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ingrediensdeklarasjon
                  </div>
                  {plain ? (
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
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Inneholder
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(calculated.allergens?.contains ?? []).length ? (
                        calculated.allergens!.contains!.map((a) => (
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
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Kan inneholde spor av
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(calculated.allergens?.may_contain ?? []).length ? (
                        calculated.allergens!.may_contain!.map((a) => (
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
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Næringsinnhold
                    </span>
                    <Badge variant="outline">Beregnet, ikke analysert</Badge>
                    {!coverageOk && <Badge variant="destructive">Kan ikke brukes på emballasje ennå</Badge>}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-1.5 text-left font-medium">Per 100 g</th>
                        <th className="py-1.5 text-right font-medium">100 g</th>
                        {factor && (
                          <th className="py-1.5 text-right font-medium">
                            Per porsjon ({Math.round(unitWeight!)} g)
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {NUT_ROWS.map((r) => {
                        const v = calculated.nutrition_per_100g?.[r.key];
                        return (
                          <tr key={r.key + r.unit} className="border-b border-border/50 last:border-0">
                            <td className={cn("py-1.5", r.indent && "pl-4 text-muted-foreground")}>
                              {r.indent ? `— ${r.label}` : r.label}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {v == null ? "—" : `${fmtNum(v, r.d)} ${r.unit}`}
                            </td>
                            {factor && (
                              <td className="py-1.5 text-right tabular-nums">
                                {v == null ? "—" : `${fmtNum(v * factor, r.d)} ${r.unit}`}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="pt-2 text-xs text-muted-foreground">
                    Tallene er <b>beregnet</b> fra råvarenes næringsdata og korrigert for stektap — de er ikke
                    laboratorieanalysert.
                  </p>
                </div>
              </>
            )}
          </SourceColumn>

          {/* ---------- Manuell ---------- */}
          <SourceColumn
            title="Manuell"
            active={manualActive}
            actions={
              canWrite ? (
                <div className="flex items-center gap-2">
                  {dirty && (
                    <Badge variant="outline" className="border-amber-500/60 text-amber-700">
                      Ulagrede endringer
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyFromCalculation}
                    disabled={busy || !calculated}
                    title={calculated ? undefined : "Merkedata er ikke beregnet ennå"}
                  >
                    <ClipboardCopy className="mr-1.5 h-4 w-4" /> Kopier fra beregning
                  </Button>
                </div>
              ) : null
            }
          >
            <div>
              <Label className="text-xs">Ingrediensdeklarasjon</Label>
              <Textarea
                rows={5}
                value={form.ingredientText}
                disabled={!canWrite}
                onChange={(e) => setField("ingredientText", e.target.value)}
                placeholder="Hvetemel, vann, salt, gjær …"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Inneholder (kommaseparert)</Label>
                <Input
                  value={form.contains}
                  disabled={!canWrite}
                  onChange={(e) => setField("contains", e.target.value)}
                  placeholder="hvete, melk"
                />
              </div>
              <div>
                <Label className="text-xs">Kan inneholde spor av (kommaseparert)</Label>
                <Input
                  value={form.mayContain}
                  disabled={!canWrite}
                  onChange={(e) => setField("mayContain", e.target.value)}
                  placeholder="nøtter, sesam"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {NUTRITION_KEYS.map((k) => (
                <div key={k}>
                  <Label className="text-xs">{NUT_LABELS[k]}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.nutrition[k] ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => setNut(k, e.target.value)}
                    className="h-9 text-right tabular-nums"
                  />
                </div>
              ))}
            </div>
            {canWrite && (
              <div className="flex justify-end">
                <Button onClick={() => saveManual.mutate()} disabled={busy || !dirty}>
                  {saveManual.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Lagre manuell deklarasjon
                </Button>
              </div>
            )}
          </SourceColumn>
        </div>

        {(drift || recipe.declaration_updated_at) && (
          <div className="space-y-2">
            {drift && (
              <DiffNote>
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>{drift}</span>
                </span>
              </DiffNote>
            )}
            {recipe.declaration_updated_at && (
              <p className="text-xs text-muted-foreground">
                Sist manuelt oppdatert {formatDateTimeNb(recipe.declaration_updated_at)}
                {updatedByName ? ` av ${updatedByName}` : ""}.
              </p>
            )}
          </div>
        )}
      </CardContent>
      <UnsavedChangesDialog
        open={unsavedGuard.isBlocked}
        onConfirm={unsavedGuard.discard}
        onCancel={unsavedGuard.stay}
      />
    </Card>
  );
}
