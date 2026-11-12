import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { showError } from "@/lib/userError";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/varer/components/products/detail/UnsavedChangesDialog";
import { useUserDisplayName, type RecipeLabelCalculated } from "@/varer/hooks/useRecipeLabel";
import type { ReactNode } from "react";
import {
  NUTRITION_KEYS,
  declarationDisplayText,
  parseAllergenSummary,
  pickNutrition,
  stripHtml,
  type DeclarationMode,
} from "@/varer/lib/effectiveDeclaration";
import { ALLERGEN_FIELD_LABEL, type AllergenApplyPlan } from "@/varer/lib/declarationAllergenSuggestion";
import { checkManualAllergens } from "@/varer/lib/manualAllergenCheck";
import type { LabelSource } from "./labelShared";
import { ConfirmPendingDialog } from "./ConfirmPendingDialog";
import { formToDoc, type Form, type Pending } from "./declarationForm";
import type { DeclarationDoc } from "./DeclarationDiffView";
import { CalculatedDeclarationPane } from "./CalculatedDeclarationPane";
import { ManualDeclarationFields } from "./ManualDeclarationFields";


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
  /** Åpner datakvaliteten nederst i kortet og går til linjene som mangler data. */
  onShowQuality: () => void;
  /** Råvarer som ikke er vurdert for allergener (fra beregningen). */
  unreviewedAllergenCount: number;
  /** Datadekning og datakvalitet — vises nederst i kortet. */
  qualitySlot: ReactNode;
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
    // Markørene (*hvete*) beholdes, så fremhevingen av allergenene følger med.
    const next: Form = {
      ingredientText: declarationDisplayText(calculated?.ingredient_declaration),
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
    focusLater("merking-editor-tekst");
  }
  function focusLater(id: string) {
    window.setTimeout(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: "center" });
      el?.focus({ preventScroll: true });
    }, 50);
  }
  function fetchAllergens() {
    setForm((f) => ({
      ...f,
      contains: (calculated?.allergens?.contains ?? []).join(", "),
      mayContain: (calculated?.allergens?.may_contain ?? []).join(", "),
    }));
    p.onCandidateChange("manual");
    toast.success("Allergenene er hentet fra råvarene — husk «Lagre kladd»");
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

  const knownAllergens = calculated ? calculated.allergens?.contains ?? [] : null;
  const allergenCheck = checkManualAllergens(form.ingredientText, knownAllergens);

  return (
    <Card id="merking-editor" tabIndex={-1} className="scroll-mt-4 outline-none">
      <CardHeader className="space-y-3 pb-3">
        <div>
          <CardTitle className="text-base">Deklarasjon og næringsinnhold</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {candidate === "auto"
              ? "Beregnes fra oppskriften og råvarenes datablad."
              : "Du skriver ingrediensliste og næringsinnhold selv."}{" "}
            Gjeldende kilde: <b>{savedMode === "manual" ? "Manuell" : "Beregnet"}</b> · gjelder {p.linkedProductCount} koblede varer.
          </p>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <label htmlFor="merking-automatisk" className="text-sm font-medium">Automatisk beregning</label>
          <Switch
            id="merking-automatisk"
            checked={candidate === "auto"}
            disabled={busy}
            onCheckedChange={(v) => p.onCandidateChange(v ? "auto" : "manual")}
          />
          <span className="text-sm text-muted-foreground" aria-hidden>{candidate === "auto" ? "På" : "Av"}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {candidate !== savedMode && (
          <div role="note" className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-xs">
            <span className="flex-1">
              Du ser på <b>{candidate === "manual" ? "manuell" : "beregnet"}</b>. Gjeldende kilde er fortsatt{" "}
              <b>{savedMode === "manual" ? "manuell" : "beregnet"}</b> — bryteren alene endrer ingenting. «Lagre som gjeldende kilde» bytter kilde uten å godkjenne; «Godkjenn denne» åpner godkjenningen.
            </span>
            {canWrite && (
              <>
                <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setPending({ kind: "source" })}>
                  Lagre som gjeldende kilde
                </Button>
                <Button className="min-h-11" onClick={p.onOpenApprove}>
                  Godkjenn denne
                </Button>
              </>
            )}
          </div>
        )}

        <div className={candidate === "auto" ? undefined : "hidden"}>
          <CalculatedDeclarationPane
            calculated={calculated}
            unitWeight={recipe.unit_weight_grams ?? null}
            plainText={plain}
            canWrite={canWrite}
            busy={busy}
            onEditAsManual={fillFromCalculation}
            onShowMissingLine={p.onShowQuality}
            onEnterManually={() => {
              p.onCandidateChange("manual");
              focusLater("merking-editor-naering");
            }}
          />
        </div>

        {/* Manuell kladd — alltid montert, så kladden overlever kildebytte og fanebytte. */}
        <div className={candidate === "manual" ? undefined : "hidden"}>
          <ManualDeclarationFields
            recipeId={recipeId}
            form={form}
            setForm={setForm}
            dirty={dirty}
            canWrite={canWrite}
            busy={busy}
            saving={saveDraft.isPending}
            hasCalculation={!!calculated}
            calcDoc={calcDoc}
            compare={compare}
            onToggleCompare={() => setCompare((v) => !v)}
            onFillFromCalculation={fillFromCalculation}
            onFetchAllergens={fetchAllergens}
            onAssistant={onAssistant}
            onAllergenSuggestion={onAllergenSuggestion}
            onSave={requestSave}
            allergenCheck={allergenCheck}
            unreviewedAllergenCount={p.unreviewedAllergenCount}
            updatedAt={recipe.declaration_updated_at ?? null}
            updatedByName={updatedByName ?? null}
          />
        </div>

        <div className="border-t pt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Datadekning og datakvalitet</div>
          {p.qualitySlot}
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
