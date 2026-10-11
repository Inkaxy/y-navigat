import { useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsWide } from "@/ravarer/pages/priskontroll/faktura/useIsWide";
import { buildOperations, selectionProblem, suggestPairs, type PendingApply, type RereadRun, type Selection } from "@/fakturaer/lib/reread";
import { RereadComparisonList } from "./RereadComparisonList";
import { RereadInspector } from "./RereadInspector";
import { RereadApplyPanel } from "./RereadApplyPanel";
import { IssueList, showValue } from "./RereadParts";

export type RereadViewProps = {
  run: RereadRun;
  document: ReactNode;
  /** Bare den som startet lesingen, med skrivetilgang, kan ta den i bruk. */
  canApply: boolean;
  readOnlyReason: string | null;
  pending: PendingApply | null;
  saving: boolean;
  applyMessage: string | null;
  onApply: (ops: ReturnType<typeof buildOperations>, reason: string) => void;
  onRetryPending: () => void;
};

/** Klar lesing: original, sammenligning og inspektør. Ingen valg er gjort på forhånd. */
export function RereadView({ run, document, canApply, readOnlyReason, pending, saving, applyMessage, onApply, onRetryPending }: RereadViewProps) {
  const wide = useIsWide(1280);
  const suggestions = useMemo(() => suggestPairs(run.candidates, run.oldLines), [run]);
  const [sel, setSel] = useState<Record<string, Selection>>({});
  const [active, setActive] = useState<string | null>(run.candidates[0]?.candidate_id ?? null);
  const [tab, setTab] = useState("linjer");
  const ops = useMemo(() => buildOperations(run.candidates, sel, run.oldLines), [run, sel]);
  const unresolved = run.candidates.filter((c) => sel[c.candidate_id]?.target != null && selectionProblem(c, sel[c.candidate_id], run.oldLines, sel)).length;
  const cand = run.candidates.find((c) => c.candidate_id === active) ?? null;
  const locked = saving || !canApply || !!pending;

  const headerCompare = (
    <div className="space-y-2 text-sm">
      <table className="w-full text-sm" aria-label="Fakturahode i dag og i ny lesing">
        <thead className="text-caption text-ink-secondary"><tr><th className="text-left font-medium">Felt</th><th className="text-left font-medium">I dag (endres ikke)</th><th className="text-left font-medium">Ny lesing</th></tr></thead>
        <tbody>
          {run.header.map((h) => (
            <tr key={h.label} className="border-t border-border"><td className="py-1 pr-2">{h.label}</td><td className="py-1 pr-2 tabular-nums">{showValue(h.old)}</td><td className="py-1 tabular-nums">{showValue(h.next)}</td></tr>
          ))}
          <tr className="border-t border-border"><td className="py-1 pr-2">Kreditnota</td><td className="py-1 pr-2">{run.invoice.is_credit_note ? "Ja" : "Nei"}</td><td className="py-1">{run.readCredit == null ? "–" : run.readCredit ? "Ser slik ut (negativ total)" : "Nei"}</td></tr>
        </tbody>
      </table>
      {run.readCredit != null && run.readCredit !== run.invoice.is_credit_note && <p className="text-caption text-warning">Ny lesing tolker kreditnota annerledes. Det endres ikke her — kontroller fakturaen.</p>}
      <IssueList title="Varsler fra ny lesing" issues={run.invoiceIssues} />
      <IssueList title="Varsler på fakturaen i dag (blir stående)" issues={run.invoice.issues} />
    </div>
  );

  const inspector = (
    <div className="space-y-4">
      {readOnlyReason && <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">{readOnlyReason}</p>}
      {cand ? (
        <RereadInspector candidate={cand} lines={run.oldLines} suggestion={suggestions[cand.candidate_id] ?? null} selection={sel[cand.candidate_id]} all={sel}
          disabled={locked} onChange={(s) => setSel((p) => ({ ...p, [cand.candidate_id]: s }))} />
      ) : <p className="text-sm text-ink-secondary">Velg en linje i listen.</p>}
      <RereadApplyPanel operations={ops} candidates={run.candidates} lines={run.oldLines} unresolved={unresolved} pending={pending} saving={saving}
        canApply={canApply} message={applyMessage} onApply={(r) => onApply(ops, r)} onRetryPending={onRetryPending} />
    </div>
  );
  const list = (
    <div className="space-y-4">
      {headerCompare}
      <RereadComparisonList candidates={run.candidates} lines={run.oldLines} suggestions={suggestions} selections={sel} activeId={active}
        onSelect={(id) => { setActive(id); if (!wide) setTab("kontroll"); }} />
    </div>
  );
  const docContext = cand && (
    <p className="truncate border-b border-border px-3 py-1.5 text-caption text-ink-secondary">
      Finn i originalen: <span className="font-medium text-foreground">{cand.values.description ?? "–"}</span>
      {cand.evidence.number_evidence.length > 0 && <> · trykt {cand.evidence.number_evidence.map((e) => `«${e.raw}»`).join(" ")}</>}
    </p>
  );

  if (wide) {
    return (
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(320px,400px)] gap-4">
        <section aria-label="Originaldokument" className="sticky top-4 flex h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-lg border border-border">{docContext}<div className="min-h-0 flex-1">{document}</div></section>
        <section aria-label="Sammenligning" className="min-w-0">{list}</section>
        <aside aria-label="Valgt linje" className="min-w-0">{inspector}</aside>
      </div>
    );
  }
  return (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="original">Original</TabsTrigger>
        <TabsTrigger value="linjer">Linjer</TabsTrigger>
        <TabsTrigger value="kontroll">Valgt linje{ops.length ? ` (${ops.length})` : ""}</TabsTrigger>
      </TabsList>
      <TabsContent value="original"><div className="flex h-[70vh] flex-col overflow-hidden rounded-lg border border-border">{docContext}<div className="min-h-0 flex-1">{document}</div></div></TabsContent>
      <TabsContent value="linjer">{list}</TabsContent>
      <TabsContent value="kontroll">{inspector}</TabsContent>
    </Tabs>
  );
}

export function ReadingState({ invoked, onInvoke, onCancel, busy }: { invoked: boolean; onInvoke: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-lg border border-border p-6 text-center" role="status" aria-live="polite">
      {invoked ? <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-hidden /> : null}
      <p className="font-medium">{invoked ? "Leser originalen på nytt …" : "Lesingen er startet, men leseren er ikke kjørt fra denne økten"}</p>
      <p className="text-sm text-ink-secondary">{invoked ? "Dette tar vanligvis under ett minutt. Du kan lukke siden og komme tilbake – lesingen er lagret." : "Kjør leseren én gang, eller avbryt. Den kan allerede være i gang fra en annen fane."}</p>
      <div className="flex justify-center gap-2">
        {!invoked && <Button size="sm" disabled={busy} onClick={onInvoke}>Kjør leseren</Button>}
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>Avbryt lesingen</Button>
      </div>
    </div>
  );
}
