import { AlertTriangle, CheckCircle2, Loader2, Minus, Save, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/varer/lib/labelChecklist";
import { buildLabelFieldRows, type LabelFieldEditor, type LabelFieldRow } from "@/varer/lib/labelFieldRows";
import { useLabelInfoForm, type LabelInfoField, type LabelInfoValues } from "@/varer/hooks/useLabelInfoForm";

interface Props {
  recipeId: string;
  /** Kladdens sjekkliste — samme som «Gjenstår» og utskriftssperren for kladden. */
  checklist: ChecklistItem[];
  values: LabelInfoValues;
  canWrite: boolean;
  /** Etikett for snarveien til der feltet rettes, eller null. */
  fixLabelFor: (key: string) => string | null;
  onFixField: (key: string) => void;
}

const FIELD: Record<LabelFieldEditor, { id: string; field: LabelInfoField; placeholder: string; unit?: string; help: string }> = {
  net_weight: { id: "etikett-nettovekt", field: "weight", placeholder: "f.eks. 750", unit: "g", help: "Nettovekt per enhet. Brukes også i «per porsjon» i næringstabellen. Vekt per vare står under «Koblede varer»." },
  shelf_life: { id: "etikett-holdbarhet", field: "shelf", placeholder: "f.eks. 5", unit: "dager", help: "Gir «Best før»: antall dager fra produksjonsdato." },
  storage: { id: "etikett-oppbevaring", field: "storage", placeholder: "f.eks. Oppbevares tørt og romtemperert", help: "Trykkes som oppbevaringsanvisning." },
  origin: { id: "etikett-opprinnelse", field: "origin", placeholder: "f.eks. Norge", help: "Opprinnelse for produktet." },
};

function StatusIcon({ level }: { level: LabelFieldRow["level"] }) {
  if (level === "ok") return <CheckCircle2 aria-label="OK" className="h-4 w-4 shrink-0 text-success" />;
  if (level === "warn") return <AlertTriangle aria-label="Bør sjekkes" className="h-4 w-4 shrink-0 text-warning" />;
  if (level === "error") return <XCircle aria-label="Mangler" className="h-4 w-4 shrink-0 text-destructive" />;
  return <Minus aria-label="Ikke satt" className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

/** «Pliktfelt på etiketten» — én sjekkliste; feltene fra etikettopplysningene redigeres i raden. */
export function LabelFieldsCard({ recipeId, checklist, values, canWrite, fixLabelFor, onFixField }: Props) {
  const rows = buildLabelFieldRows(checklist, { countryOfOrigin: values.countryOfOrigin });
  const info = useLabelInfoForm(recipeId, values, canWrite);

  const renderRow = (r: LabelFieldRow) => {
    const ed = r.editor ? FIELD[r.editor] : null;
    const fix = r.level !== "ok" && !ed ? fixLabelFor(r.key) : null;
    return (
      <li key={r.key} className="grid gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[1.25rem_10rem_minmax(0,1fr)] sm:items-start">
        <span className="pt-0.5"><StatusIcon level={r.level} /></span>
        {ed ? (
          <label htmlFor={ed.id} className="text-sm font-medium sm:pt-2.5">{r.label}</label>
        ) : (
          <span className="text-sm font-medium">{r.label}</span>
        )}
        <div className="min-w-0 space-y-1 sm:col-start-3">
          {ed ? (
            <>
              <div className="flex items-center gap-2">
                {r.editor === "storage" ? (
                  <Textarea id={ed.id} rows={2} value={info.form[ed.field]} disabled={!canWrite} placeholder={ed.placeholder} onChange={(e) => info.set(ed.field, e.target.value)} />
                ) : (
                  <Input
                    id={ed.id}
                    inputMode={r.editor === "origin" ? "text" : r.editor === "shelf_life" ? "numeric" : "decimal"}
                    value={info.form[ed.field]}
                    disabled={!canWrite}
                    placeholder={ed.placeholder}
                    onChange={(e) => info.set(ed.field, e.target.value)}
                    className={cn("min-h-11", r.editor !== "origin" && "max-w-40 text-right tabular-nums")}
                  />
                )}
                {ed.unit && <span className="text-sm text-muted-foreground">{ed.unit}</span>}
              </div>
              <p className="text-xs text-muted-foreground">{r.level === "ok" ? ed.help : `${r.detail} ${ed.help}`}</p>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn("min-w-0 break-words text-sm", r.level === "ok" ? "text-foreground" : "text-muted-foreground")}>{r.detail}</span>
              {fix ? (
                <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => onFixField(r.key)}>{fix}</Button>
              ) : r.key === "producer" && r.level !== "ok" ? (
                <span className="text-xs text-muted-foreground">Rettes i firmaopplysningene</span>
              ) : null}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <Card id="merking-pliktfelt" tabIndex={-1} className="scroll-mt-4 outline-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pliktfelt på etiketten</CardTitle>
        <p className="text-xs text-muted-foreground">
          Matinformasjonsforordningen (EU) nr. 1169/2011. Røde rader sperrer utskrift og godkjenning.
          {rows.errorCount > 0 ? ` ${rows.errorCount} gjenstår.` : " Alle påkrevde felt er på plass."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <section aria-labelledby="pliktfelt-pakrevd">
          <h3 id="pliktfelt-pakrevd" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Påkrevd</h3>
          <ul className="divide-y divide-border/60">{rows.required.map(renderRow)}</ul>
        </section>
        <section aria-labelledby="pliktfelt-anbefalt">
          <h3 id="pliktfelt-anbefalt" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anbefalt og frivillig</h3>
          <ul className="divide-y divide-border/60">{rows.other.map(renderRow)}</ul>
        </section>
        {canWrite && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
            {info.dirty && <span className="mr-auto text-xs text-warning">Ulagrede endringer i etikettopplysningene</span>}
            {info.dirty && (
              <Button type="button" variant="ghost" className="min-h-11" disabled={info.save.isPending} onClick={info.reset}>Angre</Button>
            )}
            <Button type="button" className="min-h-11" onClick={() => info.save.mutate()} disabled={info.save.isPending || !info.dirty}>
              {info.save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Lagre etikettopplysninger
            </Button>
          </div>
        )}
      </CardContent>
      <UnsavedChangesDialog {...info.guard.dialogProps} />
    </Card>
  );
}
