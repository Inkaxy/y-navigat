import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { RAVARER_EYEBROW } from "@/ravarer/pages/hub/hubTabs";
import { paths } from "@/ravarer/lib/paths";
import { useCompany } from "@/hooks/useCompany";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useBulkRereadGroups, useExtractionCostRows, type BulkInvoice } from "@/fakturaer/hooks/useBulkRereadGroups";
import { useBulkRereadRun, type StepResult } from "@/fakturaer/hooks/useBulkRereadRun";
import { BULK_GROUP_LABEL, estimateCost, fmtUsd, type BulkGroup, type StepOutcome } from "@/fakturaer/lib/bulkReread";
import { useInvoiceReadingHealth } from "@/ravarer/hooks/useInvoiceReadingHealth";
import { InvoiceReadingAlert } from "@/ravarer/components/reading/InvoiceReadingAlert";
import { formatNok } from "@/fakturaer/lib/constants";

const GROUPS: BulkGroup[] = ["uten_linjer", "gamle_avvik", "ikke_kontrollert"];

const GROUP_HELP: Record<BulkGroup, string> = {
  uten_linjer: "Fakturaene legges tilbake i den vanlige lesekøen og leses av AI på nytt. Fakturaer som har fått linjer, rettelser, godkjenning eller ført kostpris i mellomtiden hoppes over.",
  gamle_avvik: "Hver faktura leses på nytt med dagens leser og gir et forslag. Ingenting tas i bruk her: du går gjennom forslaget per faktura under «Les på nytt». Linjer som er rettet eller koblet manuelt endres bare hvis du velger det der. Forslag gjelder i 24 timer.",
  ikke_kontrollert: "Bare sumkontroll av linjene som allerede er lagret. Ingen AI, ingen kostnad, ingen linjer endres.",
};

const OUTCOME_LABEL: Record<StepOutcome, string> = {
  forslag: "Klar", hoppet_over: "Hoppet over", feilet: "Feilet", ai_feil: "AI-tjenesten feilet", ukjent: "Ukjent utfall – kontroller",
};

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join(".") : "—");

function InvoiceList({ rows }: { rows: BulkInvoice[] }) {
  return (
    <details className="rounded-md border border-border">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm">Vis fakturaene ({rows.length.toLocaleString("nb-NO")})</summary>
      <ul className="max-h-72 divide-y divide-border overflow-auto text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <Link className="min-w-[8rem] font-medium underline-offset-2 hover:underline" to={paths.faktura(r.id)}>{r.invoice_number ?? "Uten nummer"}</Link>
            <span className="text-ink-secondary">{r.supplier_name ?? "Ukjent leverandør"}</span>
            <span className="text-ink-secondary">{fmtDate(r.invoice_date)}</span>
            <span className="ml-auto tabular-nums">{r.total_amount != null ? formatNok(r.total_amount) : "—"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Results({ rows, group }: { rows: StepResult[]; group: BulkGroup }) {
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label="Resultat">
      {rows.map((r) => (
        <li key={r.invoice.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="min-w-[8rem] font-medium">{r.invoice.invoice_number ?? "Uten nummer"}</span>
          <span>{group === "ikke_kontrollert" && r.outcome === "forslag" ? `Kontrollert (${r.note === "ok" ? "stemmer" : r.note === "mismatch" ? "avvik" : r.note ?? "—"})` : OUTCOME_LABEL[r.outcome]}</span>
          {r.outcome === "forslag" && r.runId && (
            <Button asChild variant="outline" size="sm" className="ml-auto min-h-[44px]">
              <Link to={paths.lesPaNytt(r.invoice.id, { kjoring: r.runId })}>Gå gjennom forslaget</Link>
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** «Les på nytt i bolk»: viser antall og omtrentlig kostnad før start; Henrik starter selv. */
export default function LesPaNyttBolk() {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const { canWrite, loading: rightsLoading } = useInvoiceRights();
  const groupsQ = useBulkRereadGroups(le);
  const costQ = useExtractionCostRows();
  const health = useInvoiceReadingHealth(le);
  const run = useBulkRereadRun(le);
  const [confirm, setConfirm] = useState<BulkGroup | null>(null);
  const aiDown = health.data?.state === "failing";
  const healthUnknown = health.isLoading || health.isError;

  const confirmRows = confirm && groupsQ.data ? groupsQ.data[confirm] : [];
  const confirmCost = confirm && confirm !== "ikke_kontrollert" ? estimateCost(costQ.data ?? null, confirmRows.length) : null;

  return (
    <ModulePage
      eyebrow={RAVARER_EYEBROW}
      title="Les fakturaer på nytt i bolk"
      subtitle="Rydding etter at fakturalesingen stod stille. Ingenting starter før du trykker Start."
      embedsPage={false}
      actions={<Button asChild variant="ghost" size="sm" className="gap-1"><Link to={paths.priskontroll({ fane: "gjore" })}><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Priskontroll</Link></Button>}
    >
      <div className="space-y-5 px-page pb-6">
        <InvoiceReadingAlert />
        {!rightsLoading && !canWrite && <p role="status" className="text-sm">Du har lesetilgang. Bolklesing krever skrivetilgang til fakturaer.</p>}
        {groupsQ.isError ? (
          <QueryErrorState error={groupsQ.error} scope="ravarer:les-pa-nytt-bolk" onRetry={() => void groupsQ.refetch()} />
        ) : groupsQ.isLoading || !groupsQ.data ? (
          <QueryLoadingState rows={3} rowClassName="h-32" label="Henter fakturaene" />
        ) : (
          GROUPS.map((g) => {
            const rows = groupsQ.data[g];
            const usesAi = g !== "ikke_kontrollert";
            const cost = usesAi ? estimateCost(costQ.data ?? null, rows.length) : null;
            const active = run.state.phase !== "idle" && run.state.group === g;
            const blockedByAi = usesAi && (aiDown || healthUnknown);
            return (
              <Card key={g} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-2xl space-y-1">
                    <h2 className="text-lg font-semibold">{BULK_GROUP_LABEL[g]}</h2>
                    <p className="text-sm text-ink-secondary">{GROUP_HELP[g]}</p>
                    <p className="text-sm">
                      <strong>{rows.length.toLocaleString("nb-NO")}</strong> faktura(er)
                      {usesAi && <> · omtrentlig kostnad {fmtUsd(cost?.totalUsd ?? null)}{cost?.perInvoiceUsd != null ? ` (${fmtUsd(cost.perInvoiceUsd)} per faktura, snitt av ${cost.basisInvoices} siste leste)` : ""}</>}
                    </p>
                    {blockedByAi && <p role="status" className="text-sm">{aiDown ? "Kan ikke startes mens AI-tjenesten feiler. Legg inn ny nøkkel først." : "Kontrollerer AI-tjenesten …"}</p>}
                  </div>
                  <div className="flex gap-2">
                    {active && run.running && g !== "uten_linjer" && (
                      <Button variant="ghost" className="min-h-[44px]" onClick={run.stop}><X className="mr-1.5 h-4 w-4" aria-hidden />Stopp etter pågående</Button>
                    )}
                    <Button className="min-h-[44px]" disabled={!canWrite || rows.length === 0 || run.running || blockedByAi} onClick={() => setConfirm(g)}>
                      <Play className="mr-1.5 h-4 w-4" aria-hidden />Start
                    </Button>
                  </div>
                </div>
                {rows.length > 0 && <InvoiceList rows={rows} />}
                {active && run.state.phase !== "idle" && (
                  <div className="space-y-2" aria-live="polite">
                    <Progress value={run.state.progress.total ? (run.state.progress.done / run.state.progress.total) * 100 : 0} aria-label="Fremdrift" />
                    <p className="text-sm">{run.state.progress.done.toLocaleString("nb-NO")} av {run.state.progress.total.toLocaleString("nb-NO")}{run.state.phase === "done" ? ` · ${run.state.message}` : " · holder på – la siden stå åpen"}</p>
                    <Results rows={run.results} group={g} />
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start: {confirm ? BULK_GROUP_LABEL[confirm] : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRows.length.toLocaleString("nb-NO")} faktura(er).
              {confirmCost ? ` Omtrentlig kostnad: ${fmtUsd(confirmCost.totalUsd)}.` : " Ingen AI-kostnad."}
              {confirm === "gamle_avvik" ? " Fakturaene leses én om gangen og gir bare forslag. La siden stå åpen." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Avbryt</AlertDialogCancel>
            <AlertDialogAction className="min-h-[44px]" onClick={() => { const g = confirm; setConfirm(null); if (g && groupsQ.data) void run.start(g, groupsQ.data[g]); }}>Start</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ModulePage>
  );
}
