import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClipboardCopy, Copy, ListChecks, Pencil, XCircle } from "lucide-react";
import type { RecipeLabelCalculated } from "@/varer/hooks/useRecipeLabel";
import { fmtPct } from "@/varer/lib/breadscale";
import { CalculatedDeclarationView } from "./CalculatedDeclarationView";
import { TraceLabelGuidance } from "./ManualAllergenCheckNote";
import type { MissingData } from "./DataQualityCard";

interface Props {
  calculated: RecipeLabelCalculated | null;
  unitWeight: number | null;
  plainText: string;
  canWrite: boolean;
  busy: boolean;
  onEditAsManual: () => void;
  onShowMissingLine: () => void;
  onEnterManually: () => void;
}

/** Hvorfor næringsinnholdet ikke kan brukes, fra beregningens egne mangler. */
function nutritionBlockReason(c: RecipeLabelCalculated): string | null {
  const missing = (c.missing_data ?? null) as MissingData | null;
  const coverage = c.coverage_by_weight_pct ?? null;
  const names = [
    ...(missing?.critical_missing_nutrition ?? []),
    ...(missing?.lines_without_nutrition_over_pct ?? []).map((l) => l.name),
    ...(missing?.nutrition ?? []).map((l) => l.name),
  ].filter((n, i, a) => !!n && a.indexOf(n) === i);
  const hasNutrition = !!c.nutrition_per_100g;
  const coverageOk = (coverage ?? 0) >= 90;
  if (!missing?.blocked && coverageOk && hasNutrition) return null;
  const who = names.length ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` og ${names.length - 3} til` : ""} mangler næringsdata` : null;
  if (missing?.blocked) return `Kan ikke beregnes: ${who ?? "grunnlaget er ufullstendig"}.`;
  if (!coverageOk) return `Kan ikke brukes på emballasje: dekning ${fmtPct(coverage)} (krav 90 %)${who ? `. ${who}` : ""}.`;
  return "Næringsinnholdet er ikke beregnet.";
}

/** «Automatisk beregning» på: beregnet ingrediensliste og næringsinnhold, skrivebeskyttet. */
export function CalculatedDeclarationPane(p: Props) {
  if (!p.calculated) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Ikke beregnet ennå. Bruk «Beregn merkedata» øverst i Merking.
      </p>
    );
  }
  const reason = nutritionBlockReason(p.calculated);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {p.plainText && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              void navigator.clipboard.writeText(p.plainText);
              toast.success("Ingredienslisten er kopiert");
            }}
          >
            <Copy className="mr-1.5 h-4 w-4" /> Kopier tekst
          </Button>
        )}
        {p.canWrite && (
          <Button variant="outline" className="min-h-11" onClick={p.onEditAsManual} disabled={p.busy}>
            <ClipboardCopy className="mr-1.5 h-4 w-4" /> Rediger som manuell kladd
          </Button>
        )}
      </div>
      {reason && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="flex items-start gap-2 font-medium text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {reason}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={p.onShowMissingLine}>
              <ListChecks className="mr-1.5 h-4 w-4" /> Gå til linjen som mangler data
            </Button>
            <Button variant="outline" className="min-h-11" onClick={p.onEnterManually}>
              <Pencil className="mr-1.5 h-4 w-4" /> Legg inn manuelt
            </Button>
          </div>
        </div>
      )}
      <CalculatedDeclarationView calculated={p.calculated} unitWeight={p.unitWeight} />
      <TraceLabelGuidance />
    </div>
  );
}
