import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardCopy, GitCompare, Loader2, Save } from "lucide-react";
import { DeclarationAssistantPanel } from "@/varer/components/declaration/DeclarationAssistantPanel";
import { DeclarationAllergenExtractor } from "@/varer/components/declaration/DeclarationAllergenExtractor";
import type { AllergenApplyPlan } from "@/varer/lib/declarationAllergenSuggestion";
import type { ManualAllergenCheck } from "@/varer/lib/manualAllergenCheck";
import { NUT_LABELS, formToDoc, type Form } from "./declarationForm";
import { DeclarationDiffView, type DeclarationDoc } from "./DeclarationDiffView";
import { ManualAllergenCheckNote, TraceLabelGuidance } from "./ManualAllergenCheckNote";
import { formatDateTimeNb } from "./labelShared";

/** Samme rekkefølge som på etiketten, slik at manuell innføring kan følge et datablad linje for linje. */
const NUTRITION_ENTRY_ORDER = [
  "energy_kj", "energy_kcal", "fat_g", "saturated_fat_g", "carbs_g", "sugars_g", "fiber_g", "protein_g", "salt_g",
] as const;

interface Props {
  recipeId: string;
  form: Form;
  setForm: (updater: (f: Form) => Form) => void;
  dirty: boolean;
  canWrite: boolean;
  busy: boolean;
  saving: boolean;
  hasCalculation: boolean;
  calcDoc: DeclarationDoc | null;
  compare: boolean;
  onToggleCompare: () => void;
  onFillFromCalculation: () => void;
  onFetchAllergens: () => void;
  onAssistant: (text: string) => void;
  onAllergenSuggestion: (plan: AllergenApplyPlan) => void;
  onSave: () => void;
  allergenCheck: ManualAllergenCheck;
  unreviewedAllergenCount: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

/** Manuell deklarasjon — skjemaet. Ingenting lagres før «Lagre kladd». */
export function ManualDeclarationFields(p: Props) {
  const { form, setForm, canWrite } = p;
  return (
    <div className="space-y-4">
      <div role="note" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
        Manuelle verdier følger ikke oppskriften. Du må oppdatere dem selv når oppskriften endres.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {p.dirty && <Badge variant="outline" className="border-warning/60 text-warning">Ulagret kladd</Badge>}
        <div className="flex-1" />
        <Button variant="outline" className="min-h-11" onClick={p.onToggleCompare} disabled={!p.calcDoc} aria-pressed={p.compare}>
          <GitCompare className="mr-1.5 h-4 w-4" /> {p.compare ? "Skjul sammenligning" : "Sammenlign med beregningen"}
        </Button>
        {canWrite && (
          <Button variant="outline" className="min-h-11" onClick={p.onFillFromCalculation} disabled={p.busy || !p.hasCalculation}>
            <ClipboardCopy className="mr-1.5 h-4 w-4" /> Kopier fra beregnet
          </Button>
        )}
      </div>

      {p.compare && p.calcDoc && (
        <div className="rounded-md border bg-muted/20 p-3">
          <DeclarationDiffView from={p.calcDoc} to={formToDoc(form)} fromLabel="beregningen" toLabel="kladden" />
        </div>
      )}

      <div>
        <Label htmlFor="merking-editor-tekst" className="text-xs">Ingrediensliste</Label>
        <Textarea
          id="merking-editor-tekst"
          rows={5}
          value={form.ingredientText}
          disabled={!canWrite}
          onChange={(e) => setForm((f) => ({ ...f, ingredientText: e.target.value }))}
          placeholder="*Hvete*mel, vann, salt, gjær …"
        />
        <p className="mt-1 text-xs text-muted-foreground">Fremhev allergener med *stjerner* (f.eks. *hvete*mel) eller VERSALER.</p>
      </div>
      <ManualAllergenCheckNote check={p.allergenCheck} unreviewedCount={p.unreviewedAllergenCount} />
      <DeclarationAssistantPanel target="recipe" targetId={p.recipeId} value={form.ingredientText} canWrite={canWrite} onApply={p.onAssistant} />
      <DeclarationAllergenExtractor
        target="recipe"
        targetId={p.recipeId}
        value={form.ingredientText}
        canWrite={canWrite}
        current={{ contains: form.contains, mayContain: form.mayContain }}
        onApply={p.onAllergenSuggestion}
      />
      {canWrite && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Allergenene kan hentes fra råvarene i oppskriften. Ingenting lagres før du trykker «Lagre kladd».
          </span>
          <Button variant="outline" className="min-h-11" disabled={p.busy || !p.hasCalculation} onClick={p.onFetchAllergens}>
            <ClipboardCopy className="mr-1.5 h-4 w-4" /> Hent allergener fra råvarene
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="merking-editor-inneholder" className="text-xs">Inneholder (kommaseparert)</Label>
          <Input
            id="merking-editor-inneholder"
            value={form.contains}
            disabled={!canWrite}
            onChange={(e) => setForm((f) => ({ ...f, contains: e.target.value }))}
            placeholder="hvete, melk"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="merking-editor-spor" className="text-xs">Kan inneholde spor av (kommaseparert)</Label>
          <Input
            id="merking-editor-spor"
            value={form.mayContain}
            disabled={!canWrite}
            onChange={(e) => setForm((f) => ({ ...f, mayContain: e.target.value }))}
            placeholder="nøtter, sesam"
          />
          <TraceLabelGuidance />
        </div>
      </div>
      <fieldset id="merking-editor-naering" tabIndex={-1} className="scroll-mt-4 outline-none">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Næringsinnhold per 100 g</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {NUTRITION_ENTRY_ORDER.map((k) => {
            const id = `naering-${k}`;
            return (
              <div key={k}>
                <Label htmlFor={id} className="text-xs font-normal">{NUT_LABELS[k]}</Label>
                <Input
                  id={id}
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={form.nutrition[k] ?? ""}
                  disabled={!canWrite}
                  onChange={(e) => setForm((f) => ({ ...f, nutrition: { ...f.nutrition, [k]: e.target.value } }))}
                  className="min-h-11 text-right tabular-nums"
                />
              </div>
            );
          })}
        </div>
      </fieldset>
      {canWrite && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">«Lagre kladd» lagrer teksten. Den gjelder for varene først når den er godkjent.</span>
          <Button className="min-h-11" onClick={p.onSave} disabled={p.busy || !p.dirty}>
            {p.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Lagre kladd
          </Button>
        </div>
      )}
      {p.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Sist lagret {formatDateTimeNb(p.updatedAt)}
          {p.updatedByName ? ` av ${p.updatedByName}` : ""}. Lagring er ikke det samme som godkjenning.
        </p>
      )}
    </div>
  );
}
