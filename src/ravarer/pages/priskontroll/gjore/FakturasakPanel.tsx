import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetchInvoiceLines } from "@/ravarer/pages/priskontroll/faktura/useInvoiceActions";
import { canFetchLines } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useInvoiceDocumentUrl } from "@/fakturaer/hooks/useInvoiceDocument";
import { QueryState } from "@/components/common/QueryState";
import { fetchInvoiceDetail } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";
import { InvoiceFactsCard } from "@/fakturaer/components/invoice-detail/InvoiceFactsCard";
import { LinesSumMismatchAlert } from "@/fakturaer/components/LinesSumMismatchAlert";
import { ConfirmReconcileDialog } from "@/fakturaer/components/ConfirmReconcileDialog";
import { LinkCreditNoteDialog } from "@/fakturaer/components/LinkCreditNoteDialog";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { recheckInvoiceLinesSum } from "@/fakturaer/lib/linesSum";
import { unflagInvoice } from "@/fakturaer/lib/queueActions";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { paths } from "@/ravarer/lib/paths";
import { ResultBox } from "@/ravarer/ui/ResultBox";
import type { WorkItemKind } from "@/ravarer/lib/workRpcTypes";
import type { PanelResult } from "./types";
import { InvoiceCaseForm } from "./InvoiceCaseForm";
import { attemptsText } from "./logic";

/** Saksart avledet av fakturaraden — for dyplenker der elementet ikke finnes i den lastede listen. */
export function deriveInvoiceKind(d: { flagged_at: string | null; lines_sum_status: string | null; status: string | null }, lineCount: number): WorkItemKind | null {
  if (d.status === "reconciled" || d.status === "cancelled") return null;
  if (d.flagged_at) return "faktura_flagget";
  if (lineCount === 0) return "faktura_mangler_linjer";
  if (d.lines_sum_status === "mismatch") return "faktura_sumavvik";
  return "faktura_klar";
}

type Props = { invoiceId: string; kind?: WorkItemKind | null; onDone?: (r: PanelResult) => void; onNext?: () => void; onSkip?: () => void };

/** Fakturasaken: sumavvik, mangler linjer, flagget eller klar til avstemming. */
export function FakturasakPanel({ invoiceId, kind, onDone, onNext, onSkip }: Props) {
  const qc = useQueryClient();
  const { canWrite } = useInvoiceRights();
  const q = useQuery({ queryKey: ["invoice", invoiceId], queryFn: () => fetchInvoiceDetail(invoiceId) });
  const [result, setResult] = useState<PanelResult | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [unflagOpen, setUnflagOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const doc = useInvoiceDocumentUrl(q.data?.source_document_url ?? null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["invoice", invoiceId] }); invalidateRavarerCounts(qc); };
  const done = (r: PanelResult) => { setResult(r); onDone?.(r); };

  // Samme handling som arbeidsflaten. Null behandlet er ikke suksess.
  const fetchMut = useFetchInvoiceLines();
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);
  const fetchLines = {
    isPending: fetchMut.isPending,
    mutate: () => {
      const d = q.data;
      if (!d) return;
      setFetchMsg(null);
      fetchMut.mutate(d, {
        onSettled: refresh,
        onSuccess: (r) => {
          if (r.behandlet === 0) setFetchMsg("Ingen linjer ble hentet. Fakturaen kan være opptatt eller allerede lest — åpne fakturaen eller registrer linjene manuelt.");
          else done({ title: "Linjene er hentet", items: ["Fakturaen regnes om og dukker opp igjen hvis noe må avklares."] });
        },
        onError: (e: Error) => setFetchMsg(`${e.message} ${attemptsText(d.line_extraction_attempts)}`),
      });
    },
  };
  const unflag = useMutation({
    mutationFn: () => unflagInvoice(invoiceId),
    onSuccess: () => { invalidateInvoice(qc, invoiceId); invalidateRavarerCounts(qc); done({ title: "Flagget er fjernet", items: [] }); },
  });

  if (result) {
    return (
      <ResultBox title={result.title} items={result.items} onNext={onNext}>
        {result.link && <Link className="underline underline-offset-2" to={result.link.to}>{result.link.label}</Link>}
      </ResultBox>
    );
  }

  return (
    <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:fakturasak" onRetry={() => void q.refetch()}>
      {q.data && (() => {
        const d = q.data;
        const isFinal = d.status === "reconciled" || d.status === "cancelled";
        const review = d.invoice_lines.filter((l) => l.requires_review).length;
        const k = kind ?? deriveInvoiceKind(d, d.invoice_lines.length);
        return (
          <div className="space-y-5">
            <header className="space-y-1">
              <p className="text-caption text-ink-secondary">{d.suppliers?.name ?? "Ukjent leverandør"} · {formatDate(d.invoice_date)}</p>
              <h2 className="font-display text-xl">Faktura {d.invoice_number} · <span className="tabular-nums">{formatNok(d.total_amount)}</span></h2>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Link className="underline underline-offset-2" to={paths.faktura(d.id)}>Åpne faktura</Link>
                {d.source_document_url && (doc.url
                  ? <a className="inline-flex items-center gap-1 underline underline-offset-2" href={doc.url} target="_blank" rel="noreferrer"><FileText className="h-3.5 w-3.5" aria-hidden />Originalfaktura</a>
                  : <span className="inline-flex items-center gap-1 text-ink-secondary"><FileText className="h-3.5 w-3.5" aria-hidden />{doc.isLoading ? "Henter originalfaktura …" : "Originalfaktura ikke tilgjengelig"}</span>)}
              </div>
            </header>

            <InvoiceFactsCard invoice={d} canWrite={canWrite && !isFinal} fetchingLines={fetchLines.isPending} />
            {fetchMsg && <p role="alert" className="text-sm text-destructive">{fetchMsg}</p>}

            {k === "faktura_mangler_linjer" && (
              <div className="flex flex-wrap gap-2">
                {canFetchLines({ source: d.source, line_extraction_status: d.line_extraction_status, line_count: d.invoice_lines.length }) && <Button data-primary-action disabled={!canWrite || fetchLines.isPending} onClick={() => fetchLines.mutate()}>Hent linjer</Button>}
                <Button variant="outline" asChild><Link to={paths.registrerLinjer(d.id)}>Registrer linjer manuelt</Link></Button>
              </div>
            )}

            {k === "faktura_sumavvik" && (
              <LinesSumMismatchAlert invoiceId={d.id} linesSum={d.lines_sum_excl_vat} totalAmount={d.total_amount} totalVat={d.total_vat}
                variancePct={d.lines_sum_variance_pct} canOverride={canWrite && !isFinal}
                onRecheck={async () => { await recheckInvoiceLinesSum(d.id); refresh(); }}
                onOverridden={() => { refresh(); done({ title: "Sumavviket er overstyrt", items: [] }); }} />
            )}

            {k === "faktura_klar" && (
              <div className="space-y-2 rounded-md border border-line-subtle p-3">
                <p className="text-sm">Alle {d.invoice_lines.length} linjer er avklart · sum stemmer</p>
                <Button data-primary-action disabled={!canWrite || isFinal} onClick={() => setReconcileOpen(true)}>Avstem fakturaen</Button>
              </div>
            )}

            {k === "faktura_flagget" && (
              <div className="space-y-2 rounded-md border border-line-subtle p-3 text-sm">
                <p><span className="text-ink-secondary">Flaggårsak:</span> {d.flag_reason ?? "Ingen begrunnelse"}</p>
                <p className="text-caption text-ink-secondary">Flagget {formatDate(d.flagged_at)}</p>
                <div className="flex flex-wrap gap-2">
                  {/* Enter åpner bekreftelsen — flagget fjernes aldri uten et bevisst valg. */}
                  <Button data-primary-action variant="outline" disabled={!canWrite || unflag.isPending} onClick={() => setUnflagOpen(true)}>Fjern flagg …</Button>
                  <Button variant="ghost" disabled={!canWrite} onClick={() => setCaseOpen(true)}>Opprett leverandørsak</Button>
                </div>
                {caseOpen && (
                  <InvoiceCaseForm invoiceId={d.id} invoiceNumber={d.invoice_number} canWrite={canWrite} onDone={done} onCancel={() => setCaseOpen(false)}
                    lines={d.invoice_lines.map((l) => ({ id: l.id, description: l.description, price_per_base_unit: l.price_per_base_unit, expected_price_per_base_unit: l.expected_price_per_base_unit, base_quantity: l.base_quantity }))} />
                )}
                {unflag.isError && <p role="alert" className="text-destructive">Kunne ikke fjerne flagget. Prøv igjen.</p>}
              </div>
            )}

            {d.is_credit_note && <Button variant="outline" disabled={!canWrite} onClick={() => setCreditOpen(true)}>Koble kreditnota</Button>}
            {!canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}
            {onSkip && <button type="button" className="text-caption text-ink-secondary underline underline-offset-2" onClick={onSkip}>Hopp over</button>}

            <ConfirmReconcileDialog open={reconcileOpen} onOpenChange={setReconcileOpen} invoiceId={d.id} invoiceNumber={d.invoice_number} reviewLineCount={review}
              onReconciled={(n) => done({ title: "Fakturaen er avstemt", items: [`${n} prishendelser lagret`] })} />
            <AlertDialog open={unflagOpen} onOpenChange={setUnflagOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Fjerne flagget?</AlertDialogTitle>
                  <AlertDialogDescription>Fakturaen går tilbake til vanlig kontroll. Flaggårsaken blir liggende i historikken.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={() => unflag.mutate()}>Fjern flagg</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <LinkCreditNoteDialog open={creditOpen} onOpenChange={setCreditOpen}
              creditNote={{ id: d.id, invoice_number: d.invoice_number, supplier_id: d.supplier_id, legal_entity_id: d.legal_entity_id, notes: d.notes }} />
          </div>
        );
      })()}
    </QueryState>
  );
}
