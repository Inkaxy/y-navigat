import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, CheckCircle2, ChevronDown, FileText, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtGrams, fmtPct } from "@/varer/lib/breadscale";
import {
  useDatasheetsFor,
  useExtractNutritionFromDatasheet,
  type MissingNutritionRow,
} from "@/varer/hooks/useMissingNutrition";
import { ManualNutritionDialog } from "./ManualNutritionDialog";
import { MissingDeclarationNames, type MissingDeclarationNameRow } from "./MissingDeclarationNames";

export interface MissingData {
  nutrition?: MissingNutritionRow[];
  water_content?: Array<{ name?: string; raw_material_id?: string | null } | string>;
  unclassified_grain_names?: string[];
  composite_unreviewed?: Array<{ name?: string } | string>;
  composite_text_only?: Array<{ name?: string } | string>;
  declaration_names?: MissingDeclarationNameRow[];
  lines_without_raw_material?: number;
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
}

function nameList(items: MissingData["water_content"]): string[] {
  return (items ?? []).map((x) => (typeof x === "string" ? x : x?.name ?? "Uten navn")).filter(Boolean);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

/** Datakvalitet — dekning, manglende næringsdata og ALLE advarsler fra beregningen. */
export function DataQualityCard({
  coveragePct,
  missingData,
  warnings,
  onRecalculate,
  recalculating,
  canWrite,
  onGoToRecipeTab,
}: Props) {
  const pct = coveragePct ?? 0;
  const ok = pct >= 90;
  const missing = missingData?.nutrition ?? [];
  const water = nameList(missingData?.water_content);
  const unclassified = missingData?.unclassified_grain_names ?? [];
  const compositeUnreviewed = nameList(missingData?.composite_unreviewed);
  const compositeTextOnly = nameList(missingData?.composite_text_only);
  const missingDeclNames = missingData?.declaration_names ?? [];
  const unlinked = missingData?.lines_without_raw_material ?? 0;
  const warns = warnings ?? [];

  const hasIssues =
    !ok ||
    missing.length > 0 ||
    water.length > 0 ||
    unclassified.length > 0 ||
    compositeUnreviewed.length > 0 ||
    compositeTextOnly.length > 0 ||
    missingDeclNames.length > 0 ||
    unlinked > 0 ||
    warns.length > 0;

  const [open, setOpen] = useState(hasIssues);
  const rmIds = missing.map((m) => m.raw_material_id).filter((x): x is string => !!x);
  const datasheets = useDatasheetsFor(rmIds);
  const extract = useExtractNutritionFromDatasheet();
  const [manualFor, setManualFor] = useState<MissingNutritionRow | null>(null);
  const [busyRm, setBusyRm] = useState<string | null>(null);

  async function runExtract(row: MissingNutritionRow) {
    const ds = row.raw_material_id ? datasheets.data?.get(row.raw_material_id) : null;
    if (!ds || !row.raw_material_id) return;
    setBusyRm(row.raw_material_id);
    try {
      await extract.mutateAsync({ datasheet: ds, raw_material_id: row.raw_material_id });
      onRecalculate();
    } finally {
      setBusyRm(null);
    }
  }

  return (
    <>
      <Card className={cn("border-2", ok ? "border-emerald-600/40" : "border-amber-500/60")}>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CardContent className="space-y-3 pt-5">
            <div className="flex flex-wrap items-center gap-3">
              {ok ? (
                <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold tracking-tight">
                  Næringsberegningen dekker {fmtPct(coveragePct)} av deigvekten
                </p>
                {!ok && (
                  <p className="text-sm text-muted-foreground">
                    Under 90 % dekning kan næringstabellen <b>ikke</b> brukes på emballasje.
                  </p>
                )}
              </div>
              {canWrite && (
                <Button variant="outline" size="sm" onClick={onRecalculate} disabled={recalculating}>
                  {recalculating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Beregn på nytt
                </Button>
              )}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  Datakvalitet
                  <ChevronDown className={cn("ml-1.5 h-4 w-4 transition-transform", open && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", ok ? "bg-emerald-600" : "bg-amber-500")}
                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
              />
            </div>

            <CollapsibleContent className="space-y-4 pt-2">
              {!hasIssues && (
                <p className="text-sm text-muted-foreground">
                  Ingen mangler funnet — beregningsgrunnlaget er komplett.
                </p>
              )}

              {missingDeclNames.length > 0 && (
                <MissingDeclarationNames
                  rows={missingDeclNames}
                  canWrite={canWrite}
                  onSaved={onRecalculate}
                />
              )}


              {missing.length > 0 && (
                <div id="mangler-naeringsdata" className="space-y-1 scroll-mt-24">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Mangler næringsdata
                    </span>
                    <Badge variant="outline">{missing.length} råvarer</Badge>
                  </div>
                  <p className="pb-1 text-xs text-muted-foreground">
                    Tyngste råvare først — den øverste gir størst utslag på dekningen.
                  </p>
                  {missing.map((m, i) => {
                    const ds = m.raw_material_id ? datasheets.data?.get(m.raw_material_id) : null;
                    const busy = busyRm === m.raw_material_id;
                    return (
                      <div
                        key={`${m.raw_material_id ?? "x"}-${i}`}
                        className="flex flex-wrap items-center gap-2 border-b border-border/50 py-2 last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{m.name}</div>
                          <div className="text-xs tabular-nums text-muted-foreground">
                            {fmtGrams(m.grams)} · {fmtPct(m.pct_of_dough)} av deigvekten
                          </div>
                        </div>
                        {!m.raw_material_id ? (
                          <Badge variant="outline" className="text-amber-700">
                            Fritekstlinje — ikke koblet til råvare
                          </Badge>
                        ) : ds ? (
                          <Button size="sm" variant="outline" disabled={!canWrite || busy} onClick={() => runExtract(m)}>
                            {busy ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="mr-1.5 h-4 w-4" />
                            )}
                            Les ut fra datablad
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => setManualFor(m)}>
                            <Pencil className="mr-1.5 h-4 w-4" /> Legg inn manuelt
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {water.length > 0 && (
                <Group title="Mangler vanninnhold">
                  <p className="text-sm">{water.join(", ")}</p>
                  <p className="text-xs text-muted-foreground">
                    Uten vanninnhold antas 0 % — det påvirker tørrstoff, grovhet og næring per 100 g.
                  </p>
                </Group>
              )}

              {unclassified.length > 0 && (
                <Group title="Uten kornklassifisering">
                  <p className="text-sm">{unclassified.join(", ")}</p>
                  <p className="text-xs text-muted-foreground">Grovheten kan bli feil før disse er klassifisert.</p>
                </Group>
              )}

              {compositeUnreviewed.length > 0 && (
                <Group title="Sammensatte råvarer uten gjennomgang">
                  <p className="text-sm">{compositeUnreviewed.join(", ")}</p>
                </Group>
              )}

              {compositeTextOnly.length > 0 && (
                <Group title="Sammensatte råvarer kun som fritekst">
                  <p className="text-sm">{compositeTextOnly.join(", ")}</p>
                </Group>
              )}

              {unlinked > 0 && (
                <Group title="Fritekstlinjer uten råvarekobling">
                  <p className="text-sm">
                    {unlinked} ingrediens{unlinked === 1 ? "" : "er"} er fritekst. De teller <b>ikke</b> i næring,
                    allergener eller grovhet.
                  </p>
                  {onGoToRecipeTab && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onGoToRecipeTab}>
                      Gå til Oppskrift-fanen og koble dem
                    </Button>
                  )}
                </Group>
              )}

              {warns.length > 0 && (
                <Group title="Advarsler fra beregningen">
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {warns.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </Group>
              )}
            </CollapsibleContent>
          </CardContent>
        </Collapsible>
      </Card>

      <ManualNutritionDialog
        open={!!manualFor}
        onOpenChange={(v) => !v && setManualFor(null)}
        rawMaterialId={manualFor?.raw_material_id ?? null}
        rawMaterialName={manualFor?.name ?? ""}
        onSaved={onRecalculate}
      />
    </>
  );
}
