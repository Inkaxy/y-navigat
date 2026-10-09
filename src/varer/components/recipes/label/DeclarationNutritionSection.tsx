import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardCopy, Copy, GitCompare, Loader2, Save } from "lucide-react";
import { showError } from "@/lib/userError";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/varer/components/products/detail/UnsavedChangesDialog";
import { useUserDisplayName, type RecipeLabelCalculated } from "@/varer/hooks/useRecipeLabel";
import { NUTRITION_KEYS, parseAllergenSummary, pickNutrition, stripHtml, type DeclarationMode } from "@/varer/lib/effectiveDeclaration";
import { DeclarationAssistantPanel } from "@/varer/components/declaration/DeclarationAssistantPanel";
import { DeclarationAllergenExtractor } from "@/varer/components/declaration/DeclarationAllergenExtractor";
import { ALLERGEN_FIELD_LABEL, type AllergenApplyPlan } from "@/varer/lib/declarationAllergenSuggestion";
import { SourceSegmented, formatDateTimeNb, type LabelSource } from "./labelShared";
import { CalculatedDeclarationView } from "./CalculatedDeclarationView";
import { ConfirmPendingDialog } from "./ConfirmPendingDialog";
import { NUT_LABELS, formToDoc, type Form, type Pending } from "./declarationForm";

/** Samme rekkefølge som på etiketten, slik at manuell innføring kan følge et datablad linje for linje. */
const NUTRITION_ENTRY_ORDER = [
  "energy_kj", "energy_kcal", "fat_g", "saturated_fat_g", "carbs_g", "sugars_g", "fiber_g", "protein_g", "salt_g",
] as const;
import { DeclarationDiffView, type DeclarationDoc } from "./DeclarationDiffView";


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
  /** Kilden brukeren ser på — lokal til en eksplisitt handling (godkjenning/lagre kilde). */
  candidate: LabelSource;
  onCandidateChange: (s: LabelSource) => void;
  /** Gjeldende kilde er godkjent og manuell — lagring endrer det som vises på etiketten. */
  approvedManualActive: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onOpenApprove: () => void;
}

/** Én editor for valgt kilde. Ingenting skrives før brukeren eksplisitt lagrer eller godkjenner. */
export function DeclarationNutritionSection(p: Props) {
  const { recipeId, recipe, calculated, canWrite, candidate } = p;
  const qc = useQueryClient();
  const savedMode: LabelSource = (recipe.declaration_mode ?? "auto") === "manual" ? "manual" : "auto";

  const saved = useMemo<Form>(() => {
    const al = parseAllergenSummary(recipe.manual_allergen_summary);
    const n = pickNutrition(recipe.manual_nutrition);
    return {
      ingredientText: recipe.manual_ingredient_declaration ?? "",
      contains: al.contains.join(", "),
      mayContain: al.may_contain.join(", "),
      nutrition: Object.fromEntries(NUTRITION_KEYS.map((k) => [k, n?.[k] != null ? String(n[k]) : ""])),
    };
  }, [recipe.manual_allergen_summary, recipe.manual_ingredient_declaration, recipe.manual_nutrition]);

  const [form, setForm] = useState<Form>(saved);
  const dirtyRef = useRef(false);
  // Refetch skal aldri nullstille en ulagret kladd.
  useEffect(() => {
    if (!dirtyRef.current) setForm(saved);
  }, [saved]);

  const dirty =
    form.ingredientText !== saved.ingredientText ||
    form.contains !== saved.contains ||
    form.mayContain !== saved.mayContain ||
    NUTRITION_KEYS.some((k) => (form.nutrition[k] ?? "") !== (saved.nutrition[k] ?? ""));
  dirtyRef.current = dirty;
  const { onDirtyChange } = p;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const unsavedGuard = useUnsavedChangesGuard(dirty && canWrite);

  const [compare, setCompare] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const afterWrite = async () => {
    const { error } = await supabase.functions.invoke("compute-recipe-label", { body: { recipe_id: recipeId } });
    if (error) console.error("compute-recipe-label", error);
    qc.invalidateQueries({ queryKey: ["recipe-detail", recipeId] });
    qc.invalidateQueries({ queryKey: ["recipe-label-calculated", recipeId] });
    qc.invalidateQueries({ queryKey: ["recipe-linked-products"] });
    qc.invalidateQueries({ queryKey: ["recipes-labeling-status"] });
  };

  const saveSource = useMutation({
    mutationFn: async (m: DeclarationMode) => {
      const { error } = await supabase.from("recipes").update({ declaration_mode: m }).eq("id", recipeId);
      if (error) throw error;
      return afterWrite();
    },
    onSuccess: () => toast.success("Kildevalget er lagret — godkjenn for å oppdatere varene"),
    onError: (e: unknown) => showError("DeclarationNutritionSection", e),
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const doc = formToDoc(form);
      const nut: Record<string, number> = {};
      for (const k of NUTRITION_KEYS) if (doc.nutrition?.[k] != null) nut[k] = doc.nutrition[k] as number;
      const { error } = await supabase
        .from("recipes")
        .update({
          manual_ingredient_declaration: doc.ingredientText,
          manual_allergen_summary: { contains: doc.contains, may_contain: doc.mayContain },
          manual_nutrition: Object.keys(nut).length ? nut : null,
          declaration_updated_at: new Date().toISOString(),
          declaration_updated_by: u.user?.id ?? null,
        } as never)
        .eq("id", recipeId);
      if (error) throw error;
      const normalized: Form = {
        ingredientText: doc.ingredientText ?? "",
        contains: doc.contains.join(", "),
        mayContain: doc.mayContain.join(", "),
        nutrition: Object.fromEntries(NUTRITION_KEYS.map((k) => [k, nut[k] != null ? String(nut[k]) : ""])),
      };
      dirtyRef.current = false;
      await afterWrite();
      return normalized;
    },
    onSuccess: (normalized) => {
      setForm(normalized);
      dirtyRef.current = false;
      toast.success("Kladden er lagret. Den gjelder først når den er godkjent.");
    },
    onError: (e: unknown) => showError("DeclarationNutritionSection", e),
  });

  const busy = saveSource.isPending || saveDraft.isPending;
  const updatedByName = useUserDisplayName(recipe.declaration_updated_by ?? null).data;
  const calcDoc: DeclarationDoc | null = calculated
    ? {
        ingredientText: calculated.ingredient_declaration ?? null,
        contains: calculated.allergens?.contains ?? [],
        mayContain: calculated.allergens?.may_contain ?? [],
        nutrition: (calculated.nutrition_per_100g ?? null) as Record<string, number | null> | null,
      }
    : null;
  const plain = stripHtml(calculated?.ingredient_declaration ?? "");
  const formHasContent = !!form.ingredientText.trim() || !!form.contains.trim() || NUTRITION_KEYS.some((k) => form.nutrition[k]);

  function fillFromCalculation() {
    const calc = pickNutrition(calculated?.nutrition_per_100g);
    const next: Form = {
      ingredientText: plain,
      contains: (calculated?.allergens?.contains ?? []).join(", "),
      mayContain: (calculated?.allergens?.may_contain ?? []).join(", "),
      nutrition: Object.fromEntries(NUTRITION_KEYS.map((k) => [k, calc?.[k] != null ? String(calc[k]) : ""])),
    };
    if (formHasContent) setPending({ kind: "fill", next });
    else applyFill(next);
  }
  function applyFill(next: Form) {
    setForm(next);
    p.onCandidateChange("manual");
    toast.success("Kladden er fylt ut fra beregningen — husk «Lagre kladd»");
  }
  function onAssistant(text: string) {
    if (form.ingredientText.trim() && form.ingredientText.trim() !== text.trim()) setPending({ kind: "assistant", text });
    else setForm((f) => ({ ...f, ingredientText: text }));
  }
  function onAllergenSuggestion(plan: AllergenApplyPlan) {
    const summary = plan.changes
      .map((c) => `${ALLERGEN_FIELD_LABEL[c.field]}: ${c.before.trim() ? `«${c.before}»` : "tomt"} → «${c.after}»`)
      .join(". ");
    if (plan.needsConfirm) setPending({ kind: "allergens", next: plan.next, summary });
    else applyAllergens(plan.next);
  }
  function applyAllergens(next: { contains: string; mayContain: string }) {
    setForm((f) => ({ ...f, contains: next.contains, mayContain: next.mayContain }));
    toast.success("Allergenforslaget er lagt inn i kladden — husk «Lagre kladd»");
  }
  function requestSave() {
    const overwrites = !!saved.ingredientText.trim() && saved.ingredientText !== form.ingredientText;
    if (p.approvedManualActive || overwrites) setPending({ kind: "save" });
    else saveDraft.mutate();
  }

  const confirmText: Record<Pending["kind"], { title: string; body: string; action: string }> = {
    allergens: {
      title: "Erstatte allergenfeltene med forslaget?",
      body: `${pending?.kind === "allergens" ? pending.summary + ". " : ""}Ingenting lagres før du trykker «Lagre kladd».`,
      action: "Bruk allergenforslag",
    },
    fill: {
      title: "Erstatte kladden med beregningen?",
      body: "Teksten, allergenene og næringstallene i kladden byttes ut med det beregnede. Ingenting lagres før du trykker «Lagre kladd».",
      action: "Erstatt kladden",
    },
    assistant: {
      title: "Erstatte ingredienslisten med forslaget?",
      body: "Den nåværende teksten i kladden byttes ut. Ingenting lagres før du trykker «Lagre kladd».",
      action: "Bruk forslaget",
    },
    save: {
      title: "Overskrive lagret kladd?",
      body: p.approvedManualActive
        ? "Den manuelle deklarasjonen er gjeldende og godkjent. Lagrer du, viser etiketten den nye teksten, og merkingen blir utdatert til den godkjennes på nytt. Varene beholder godkjent versjon til da."
        : "Den lagrede manuelle teksten blir erstattet. Den gjelder først når den er godkjent.",
      action: "Lagre kladd",
    },
    source: {
      title: `Lagre «${candidate === "manual" ? "Manuell" : "Beregnet"}» som gjeldende kilde?`,
      body: "Etiketten bruker da denne kilden. Varene oppdateres først ved godkjenning, og merkingen må godkjennes på nytt.",
      action: "Lagre kildevalg",
    },
  };

  function confirmPending() {
    if (!pending) return;
    if (pending.kind === "fill") applyFill(pending.next);
    else if (pending.kind === "assistant") setForm((f) => ({ ...f, ingredientText: pending.text }));
    else if (pending.kind === "allergens") applyAllergens(pending.next);
    else if (pending.kind === "save") saveDraft.mutate();
    else saveSource.mutate(candidate === "manual" ? "manual" : "auto");
    setPending(null);
  }

  return (
    <Card id="merking-editor" tabIndex={-1} className="scroll-mt-4 outline-none">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">Deklarasjon &amp; næringsinnhold</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Gjeldende kilde: <b>{savedMode === "manual" ? "Manuell" : "Beregnet"}</b> · gjelder {p.linkedProductCount} koblede
            varer.
          </p>
        </div>
        <SourceSegmented caption="Vis og rediger:" value={candidate} disabled={busy} onChange={p.onCandidateChange} />
      </CardHeader>
      <CardContent className="space-y-4">
        {candidate !== savedMode && (
          <div role="note" className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-xs">
            <span className="flex-1">
              Du ser på <b>{candidate === "manual" ? "manuell" : "beregnet"}</b>. Gjeldende kilde er fortsatt{" "}
              <b>{savedMode === "manual" ? "manuell" : "beregnet"}</b> — visningen alene endrer ingenting. «Lagre som gjeldende kilde» bytter kilde uten å godkjenne; «Godkjenn denne» åpner godkjenningen.
            </span>
            {canWrite && (
              <>
                <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setPending({ kind: "source" })}>
                  Lagre som gjeldende kilde
                </Button>
                <Button size="sm" className="h-7" onClick={p.onOpenApprove}>
                  Godkjenn denne
                </Button>
              </>
            )}
          </div>
        )}

        {/* Beregnet */}
        <div className={candidate === "auto" ? "space-y-3" : "hidden"}>
          {!calculated ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Ikke beregnet ennå. Bruk «Beregn merkedata» øverst i Merking.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {plain && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(plain);
                      toast.success("Ingredienslisten er kopiert");
                    }}
                  >
                    <Copy className="mr-1.5 h-4 w-4" /> Kopier tekst
                  </Button>
                )}
                {canWrite && (
                  <Button variant="outline" size="sm" onClick={fillFromCalculation} disabled={busy}>
                    <ClipboardCopy className="mr-1.5 h-4 w-4" /> Rediger som manuell kladd
                  </Button>
                )}
              </div>
              <CalculatedDeclarationView calculated={calculated} unitWeight={recipe.unit_weight_grams ?? null} />
            </>
          )}
        </div>

        {/* Manuell kladd — alltid montert, så kladden overlever kildebytte og fanebytte. */}
        <div className={candidate === "manual" ? "space-y-4" : "hidden"}>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300">
                Ulagret kladd
              </Badge>
            )}
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setCompare((v) => !v)} disabled={!calcDoc} aria-pressed={compare}>
              <GitCompare className="mr-1.5 h-4 w-4" /> {compare ? "Skjul sammenligning" : "Sammenlign med beregningen"}
            </Button>
            {canWrite && (
              <Button variant="outline" size="sm" onClick={fillFromCalculation} disabled={busy || !calculated}>
                <ClipboardCopy className="mr-1.5 h-4 w-4" /> Fyll fra beregningen
              </Button>
            )}
          </div>

          {compare && calcDoc && (
            <div className="rounded-md border bg-muted/20 p-3">
              <DeclarationDiffView from={calcDoc} to={formToDoc(form)} fromLabel="beregningen" toLabel="kladden" />
            </div>
          )}

          <div>
            <Label htmlFor="merking-editor-tekst" className="text-xs">Ingrediensdeklarasjon</Label>
            <Textarea
              id="merking-editor-tekst"
              rows={5}
              value={form.ingredientText}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, ingredientText: e.target.value }))}
              placeholder="Hvetemel, vann, salt, gjær …"
            />
          </div>
          <DeclarationAssistantPanel
            target="recipe"
            targetId={recipeId}
            value={form.ingredientText}
            canWrite={canWrite}
            onApply={onAssistant}
          />
          <DeclarationAllergenExtractor
            target="recipe"
            targetId={recipeId}
            value={form.ingredientText}
            canWrite={canWrite}
            current={{ contains: form.contains, mayContain: form.mayContain }}
            onApply={onAllergenSuggestion}
          />
          {canWrite && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Allergenene kan hentes fra råvarene i oppskriften. Ingenting lagres før du trykker «Lagre kladd».
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !calculated}
                onClick={() => {
                  setForm((f) => ({
                    ...f,
                    contains: (calculated?.allergens?.contains ?? []).join(", "),
                    mayContain: (calculated?.allergens?.may_contain ?? []).join(", "),
                  }));
                  p.onCandidateChange("manual");
                  toast.success("Allergenene er hentet fra råvarene — husk «Lagre kladd»");
                }}
              >
                <ClipboardCopy className="mr-1.5 h-4 w-4" /> Hent allergener fra råvarene
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Inneholder (kommaseparert)</Label>
              <Input
                value={form.contains}
                disabled={!canWrite}
                onChange={(e) => setForm((f) => ({ ...f, contains: e.target.value }))}
                placeholder="hvete, melk"
              />
            </div>
            <div>
              <Label className="text-xs">Kan inneholde spor av (kommaseparert)</Label>
              <Input
                value={form.mayContain}
                disabled={!canWrite}
                onChange={(e) => setForm((f) => ({ ...f, mayContain: e.target.value }))}
                placeholder="nøtter, sesam"
              />
            </div>
          </div>
          <div id="merking-editor-naering" tabIndex={-1} className="max-w-md scroll-mt-4 divide-y rounded-md border outline-none">
            {NUTRITION_ENTRY_ORDER.map((k) => {
              const indent = k === "saturated_fat_g" || k === "sugars_g";
              const id = `naering-${k}`;
              return (
                <div key={k} className="flex items-center gap-3 px-3 py-1.5">
                  <Label htmlFor={id} className={`flex-1 text-sm font-normal ${indent ? "pl-4 text-muted-foreground" : ""}`}>
                    {indent ? "– " : ""}{NUT_LABELS[k]}
                  </Label>
                  <Input
                    id={id}
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    value={form.nutrition[k] ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => setForm((f) => ({ ...f, nutrition: { ...f.nutrition, [k]: e.target.value } }))}
                    className="h-8 w-28 text-right tabular-nums"
                  />
                </div>
              );
            })}
          </div>
          {canWrite && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-muted-foreground">
                «Lagre kladd» lagrer teksten. Den gjelder for varene først når den er godkjent.
              </span>
              <Button onClick={requestSave} disabled={busy || !dirty}>
                {saveDraft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Lagre kladd
              </Button>
            </div>
          )}
          {recipe.declaration_updated_at && (
            <p className="text-xs text-muted-foreground">
              Sist lagret {formatDateTimeNb(recipe.declaration_updated_at)}
              {updatedByName ? ` av ${updatedByName}` : ""}. Lagring er ikke det samme som godkjenning.
            </p>
          )}
        </div>
      </CardContent>

      <ConfirmPendingDialog
        open={!!pending}
        text={pending ? confirmText[pending.kind] : null}
        onCancel={() => setPending(null)}
        onConfirm={confirmPending}
      />
      <UnsavedChangesDialog open={unsavedGuard.isBlocked} onConfirm={unsavedGuard.discard} onCancel={unsavedGuard.stay} />
    </Card>
  );
}
