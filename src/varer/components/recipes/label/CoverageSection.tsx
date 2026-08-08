import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtGrams, fmtPct } from "@/varer/lib/breadscale";
import {
  useDatasheetsFor,
  useExtractNutritionFromDatasheet,
  type MissingNutritionRow,
} from "@/varer/hooks/useMissingNutrition";
import { ManualNutritionDialog } from "./ManualNutritionDialog";

interface Props {
  coveragePct: number | null;
  missing: MissingNutritionRow[];
  onRecalculate: () => void;
  recalculating: boolean;
  canWrite: boolean;
}

/** Datadekning — det første og viktigste på merkefanen. */
export function CoverageSection({ coveragePct, missing, onRecalculate, recalculating, canWrite }: Props) {
  const pct = coveragePct ?? 0;
  const ok = pct >= 90;
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
                  Under 90 % dekning kan næringstabellen <b>ikke</b> brukes på emballasje. Tallene vises nedtonet
                  til råvarene under har næringsdata.
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={onRecalculate} disabled={recalculating}>
              {recalculating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Beregn på nytt
            </Button>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", ok ? "bg-emerald-600" : "bg-amber-500")}
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {missing.length > 0 && (
        <Card id="mangler-naeringsdata">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Mangler næringsdata{" "}
              <Badge variant="outline" className="ml-1">{missing.length} råvarer</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="pb-2 text-xs text-muted-foreground">
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
                    <div className="text-xs text-muted-foreground">
                      {fmtGrams(m.grams)} · {fmtPct(m.pct_of_dough)} av deigvekten
                    </div>
                  </div>
                  {!m.raw_material_id ? (
                    <Badge variant="outline" className="text-amber-700">Fritekstlinje — ikke koblet til råvare</Badge>
                  ) : ds ? (
                    <Button size="sm" variant="outline" disabled={!canWrite || busy} onClick={() => runExtract(m)}>
                      {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
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
          </CardContent>
        </Card>
      )}

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
