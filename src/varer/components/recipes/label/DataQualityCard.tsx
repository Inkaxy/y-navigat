import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, FileText, Link2, Loader2, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FoodPickerDialog } from "@/ravarer/components/matvaretabellen/FoodPickerDialog";
import { cn } from "@/lib/utils";
import { fmtGrams, fmtPct } from "@/varer/lib/breadscale";
import {
  useDatasheetsFor,
  useExtractNutritionFromDatasheet,
  type MissingNutritionRow,
} from "@/varer/hooks/useMissingNutrition";
import {
  ISSUE_LABEL,
  buildQualityTasks,
  dedupeMessages,
  type QualityIssueKind,
  type QualityTask,
} from "@/varer/lib/labelQualityTasks";
import { ManualNutritionDialog } from "./ManualNutritionDialog";
import { DeclarationNameInline, type MissingDeclarationNameRow } from "./MissingDeclarationNames";
import {
  ConfirmAllergensInline,
  FreeTextLinkInline,
  GrainClassInline,
  WaterContentInline,
} from "./InlineRawMaterialFix";

export interface MissingData {
  nutrition?: MissingNutritionRow[];
  water_content?: Array<{ name?: string; raw_material_id?: string | null } | string>;
  unclassified_grain_names?: string[];
  composite_unreviewed?: Array<{ name?: string } | string>;
  composite_text_only?: Array<{ name?: string } | string>;
  declaration_names?: MissingDeclarationNameRow[];
  lines_without_raw_material?: number;
  /** Linjer over 0,25 % av vekten uten komplett næringsdata. */
  lines_without_nutrition_over_pct?: Array<{ name: string; pct_of_weight?: number }>;
  /** Salt, vann eller gjær uten næringsrad — hard sperre. */
  critical_missing_nutrition?: string[];
  /** Råvarer som ikke er gjennomgått for allergener. */
  allergens_unreviewed?: Array<{ raw_material_id?: string | null; name: string; pct_of_weight?: number }>;
  /** Ukjent enhet eller stk uten stykkvekt. */
  unit_problems?: Array<{ name: string; reason?: string }>;
  /** Fritekstlinjer som sperrer automatisk deklarasjon. */
  free_text_lines?: Array<{ name: string; grams?: number }>;
  fiber_complete?: boolean;
  missing_bake_loss?: boolean;
  blocked?: boolean;
  block_reasons?: string[];
}

interface Props {
  coveragePct: number | null;
  missingData: MissingData | null;
  warnings: string[] | null;
  onRecalculate: () => void;
  recalculating: boolean;
  canWrite: boolean;
  /** Bytter til Oppskrift-fanen for å koble fritekstlinjer. */
  onGoToRecipeTab?: () => void;
  /** Oppskriften kortet gjelder — kreves for inline-kobling av fritekstlinjer. */
  recipeId?: string;
  /** Økes av forelderen for å åpne oppgavelisten (f.eks. «Se hva som mangler»). */
  openSignal?: number;
}

function rmLink(id: string, tab?: string): string {
  return `/ravarer/vareliste/${id}${tab ? `?tab=${tab}` : ""}`;
}

/** Datakvalitet — ÉN oppgaveliste, én rad per ingrediens, samme rettehandlinger overalt. */
export function DataQualityCard({
  coveragePct,
  missingData,
  warnings,
  onRecalculate,
  recalculating,
  canWrite,
  onGoToRecipeTab,
  recipeId,
  openSignal,
}: Props) {
  const pct = coveragePct ?? 0;
  const ok = pct >= 90;
  // Oppskriftens fritekstlinjer: stabile id-er for å slå sammen beregningens rapporter om samme linje.
  const freeTextQuery = useQuery({
    queryKey: ["recipe-free-text-lines", recipeId],
    enabled: !!recipeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_lines")
        .select("id, ingredient_name")
        .eq("recipe_id", recipeId!)
        .is("raw_material_id", null)
        .limit(500);
      if (error) throw error;
      return (data ?? [])
        .filter((r) => !!r.ingredient_name)
        .map((r) => ({ id: r.id as string, name: r.ingredient_name as string }));
    },
  });
  const { tasks, recipeTasks } = useMemo(
    () => buildQualityTasks(missingData, freeTextQuery.data ?? []),
    [missingData, freeTextQuery.data],
  );
  const messages = useMemo(
    () => dedupeMessages(missingData?.block_reasons, warnings),
    [missingData?.block_reasons, warnings],
  );
  const blocked = missingData?.blocked === true;
  const blockingCount = tasks.filter((t) => t.blocking).length;
  const taskCount = tasks.length + recipeTasks.length;

  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  const rmIds = tasks
    .filter((t) => t.rawMaterialId && t.issues.some((i) => i.kind === "nutrition" || i.kind === "critical_nutrition"))
    .map((t) => t.rawMaterialId as string);
  const datasheets = useDatasheetsFor(rmIds);
  const extract = useExtractNutritionFromDatasheet();
  const [manualFor, setManualFor] = useState<QualityTask | null>(null);
  const [foodPickerFor, setFoodPickerFor] = useState<QualityTask | null>(null);
  const [busyRm, setBusyRm] = useState<string | null>(null);

  async function runExtract(t: QualityTask) {
    const ds = t.rawMaterialId ? datasheets.data?.get(t.rawMaterialId) : null;
    if (!ds || !t.rawMaterialId) return;
    setBusyRm(t.rawMaterialId);
    try {
      await extract.mutateAsync({ datasheet: ds, raw_material_id: t.rawMaterialId });
      onRecalculate();
    } finally {
      setBusyRm(null);
    }
  }

  const summary =
    taskCount === 0
      ? "Ingen oppgaver — beregningsgrunnlaget er komplett."
      : `${taskCount} oppgave${taskCount === 1 ? "" : "r"}${blockingCount ? ` · ${blockingCount} sperrer beregnet deklarasjon` : ""}`;

  function fixFor(t: QualityTask, kind: QualityIssueKind) {
    const id = t.rawMaterialId;
    switch (kind) {
      case "free_text":
        return recipeId ? (
          <FreeTextLinkInline recipeId={recipeId} name={t.name} disabled={!canWrite} onSaved={onRecalculate} />
        ) : onGoToRecipeTab ? (
          <Button size="sm" variant="outline" className="h-8" onClick={onGoToRecipeTab}>
            Koble i Oppskrift-fanen
          </Button>
        ) : null;
      case "nutrition":
      case "critical_nutrition": {
        if (!id) return null;
        const ds = datasheets.data?.get(id);
        const busy = busyRm === id;
        return (
          <div className="flex flex-wrap items-center gap-2">
            {ds && (
              <Button size="sm" variant="outline" className="h-8" disabled={!canWrite || busy} onClick={() => runExtract(t)}>
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
                Les ut fra datablad
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8" disabled={!canWrite} onClick={() => setFoodPickerFor(t)}>
              <Link2 className="mr-1.5 h-4 w-4" /> Koble Matvaretabellen
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={!canWrite} onClick={() => setManualFor(t)}>
              <Pencil className="mr-1.5 h-4 w-4" /> Legg inn manuelt
            </Button>
          </div>
        );
      }
      case "allergens":
        return (
          <ConfirmAllergensInline rawMaterialId={id} name={t.name} disabled={!canWrite} onSaved={onRecalculate} />
        );
      case "declaration_name":
        return id ? (
          <DeclarationNameInline rawMaterialId={id} fallback={t.fallbackName} disabled={!canWrite} onSaved={onRecalculate} />
        ) : null;
      case "water":
        return <WaterContentInline rawMaterialId={id} name={t.name} disabled={!canWrite} onSaved={onRecalculate} />;
      case "grain_class":
        return <GrainClassInline name={t.name} disabled={!canWrite} onSaved={onRecalculate} />;
      case "unit":
        return onGoToRecipeTab ? (
          <Button size="sm" variant="outline" className="h-8" onClick={onGoToRecipeTab}>
            Rett i Oppskrift-fanen
          </Button>
        ) : null;
      default:
        return null;
    }
  }

  return (
    <>
      <Card className={cn("border-2", ok && !blocked ? "border-emerald-600/40" : "border-amber-500/60")}>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CardContent className="space-y-3 pt-5">
            <div className="flex flex-wrap items-center gap-3">
              {ok && !blocked ? (
                <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold tracking-tight">
                  Næringsberegningen dekker {fmtPct(coveragePct)} av deigvekten
                </p>
                <p className="text-sm text-muted-foreground">
                  {summary}
                  {!ok && " Under 90 % dekning kan næringstabellen ikke brukes på emballasje."}
                </p>
              </div>
              {recalculating && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Beregner …
                </span>
              )}
              {taskCount + messages.length > 0 && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" aria-expanded={open}>
                    {open ? "Skjul oppgaver" : "Vis oppgaver"}
                    <ChevronDown className={cn("ml-1.5 h-4 w-4 transition-transform", open && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", ok ? "bg-emerald-600" : "bg-amber-500")}
                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
              />
            </div>

            <CollapsibleContent className="space-y-3 pt-1">
              {tasks.length > 0 && (
                <ul aria-label="Oppgaver i datakvalitet" className="divide-y divide-border/60 rounded-md border">
                  {tasks.map((t) => (
                    <li key={t.key} className="space-y-2 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {t.name}
                          <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
                            {[t.grams != null ? fmtGrams(t.grams) : null, t.pctOfWeight != null ? `${fmtPct(t.pctOfWeight)} av vekten` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {t.blocking && <Badge variant="destructive">Sperrer</Badge>}
                        {t.rawMaterialId && (
                          <Link
                            to={rmLink(t.rawMaterialId, "nutrition")}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                          >
                            Åpne råvarekortet <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      <ul className="space-y-1.5">
                        {t.issues.map((i) => (
                          <li key={i.kind} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="text-muted-foreground">
                              {ISSUE_LABEL[i.kind]}
                              {i.detail ? ` — ${i.detail}` : ""}
                            </span>
                            {fixFor(t, i.kind)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}

              {recipeTasks.map((r) => (
                <div key={r.key} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{r.title}</p>
                  <p className="text-muted-foreground">{r.detail}</p>
                  {r.key === "unlinked_lines" && onGoToRecipeTab && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onGoToRecipeTab}>
                      Gå til Oppskrift-fanen og koble dem
                    </Button>
                  )}
                </div>
              ))}

              {messages.length > 0 && (
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Meldinger fra beregningen ({messages.length})
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {messages.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </CollapsibleContent>
          </CardContent>
        </Collapsible>
      </Card>

      <ManualNutritionDialog
        open={!!manualFor}
        onOpenChange={(v) => !v && setManualFor(null)}
        rawMaterialId={manualFor?.rawMaterialId ?? null}
        rawMaterialName={manualFor?.name ?? ""}
        onSaved={onRecalculate}
      />

      {foodPickerFor?.rawMaterialId && (
        <FoodPickerDialog
          open
          onOpenChange={(v) => {
            if (!v) {
              setFoodPickerFor(null);
              // Koblingen skriver næring på råvaren — beregn oppskriften på nytt.
              onRecalculate();
            }
          }}
          rawMaterialId={foodPickerFor.rawMaterialId}
        />
      )}
    </>
  );
}
