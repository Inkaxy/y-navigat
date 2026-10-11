import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { supabase } from "@/integrations/supabase/client";
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

type Props = { invoiceId: string; kind?: WorkItemKind | null; onDone?: (r: PanelResult) => void; onNext?: () => void; onSkip?: () => void };

/** Fakturasaken: sumavvik, mangler linjer, flagget eller klar til avstemming. */
export function FakturasakPanel({ invoiceId, kind, onDone, onNext, onSkip }: Props) {
  const qc = useQueryClient();
  const { canWrite } = useInvoiceRights();
  const q = useQuery({ queryKey: ["invoice", invoiceId], queryFn: () => fetchInvoiceDetail(invoiceId) });
  const [result, setResult] = useState<PanelResult | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["invoice", invoiceId] }); invalidateRavarerCounts(qc); };
  const done = (r: PanelResult) => { setResult(r); onDone?.(r); };

  const fetchLines = useMutation({
    mutationFn: async () => {
      const d = q.data;
      if (!d) throw new Error("Fakturaen er ikke lastet.");
      const { data, error } = await supabase.functions.invoke("tripletex-import-invoice-lines", { body: { legal_entity_id: d.legal_entity_id, invoice_id: d.id, limit: 1 } });
      if (error) throw new Error("Kunne ikke hente linjer. Prøv igjen.");
      const failed = typeof data === "object" && data !== null && "feilet" in data ? Number(data.feilet) : 0;
      if (failed > 0) throw new Error("Kunne ikke lese linjer fra PDF-en.");
    },
    onSettled: refresh,
  });
  const unflag = useMutation({
    mutationFn: () => unflagInvoice(invoiceId),
    onSuccess: () => { invalidateInvoice(qc, invoiceId); invalidateRavarerCounts(qc); done({ title: "Flagget er fjernet", items: [] }); },
  });

  if (result) return <ResultBox title={result.title} items={result.items} onNext={onNext} />;

  return (
    <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:fakturasak" onRetry={() => void q.refetch()}>
      {q.data && (() => {
        const d = q.data;
        const isFinal = d.status === "reconciled" || d.status === "cancelled";
        const review = d.invoice_lines.filter((l) => l.requires_review).length;
        const k = kind ?? (d.flagged_at ? "faktura_flagget" : null);
        return (
          <div className="space-y-5">
            <header className="space-y-1">
              <p className="text-caption text-ink-secondary">{d.suppliers?.name ?? "Ukjent leverandør"} · {formatDate(d.invoice_date)}</p>
              <h2 className="font-display text-xl">Faktura {d.invoice_number} · <span className="tabular-nums">{formatNok(d.total_amount)}</span></h2>
              <Link className="text-sm underline underline-offset-2" to={paths.faktura(d.id)}>Åpne faktura</Link>
            </header>

            <InvoiceFactsCard invoice={d} canWrite={canWrite && !isFinal} fetchingLines={fetchLines.isPending} onFetchLines={() => fetchLines.mutate()} />
            {fetchLines.isError && <p role="alert" className="text-sm text-destructive">{fetchLines.error.message} Forsøk {d.line_extraction_attempts ?? 0}/3.</p>}

            {k === "faktura_mangler_linjer" && (
              <div className="flex flex-wrap gap-2">
                <Button data-primary-action disabled={!canWrite || fetchLines.isPending} onClick={() => fetchLines.mutate()}>Hent linjer</Button>
                <Button variant="outline" asChild><Link to={paths.faktura(d.id)}>Registrer linjer manuelt</Link></Button>
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
                  <Button data-primary-action variant="outline" disabled={!canWrite || unflag.isPending} onClick={() => unflag.mutate()}>Fjern flagg</Button>
                  <Button variant="ghost" asChild><Link to={paths.faktura(d.id)}>Opprett leverandørsak</Link></Button>
                </div>
                {unflag.isError && <p role="alert" className="text-destructive">Kunne ikke fjerne flagget. Prøv igjen.</p>}
              </div>
            )}

            {d.is_credit_note && <Button variant="outline" disabled={!canWrite} onClick={() => setCreditOpen(true)}>Koble kreditnota</Button>}
            {!canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}
            {onSkip && <button type="button" className="text-caption text-ink-secondary underline underline-offset-2" onClick={onSkip}>Hopp over</button>}

            <ConfirmReconcileDialog open={reconcileOpen} onOpenChange={setReconcileOpen} invoiceId={d.id} invoiceNumber={d.invoice_number} reviewLineCount={review}
              onReconciled={(n) => done({ title: "Fakturaen er avstemt", items: [`${n} prishendelser lagret`] })} />
            <LinkCreditNoteDialog open={creditOpen} onOpenChange={setCreditOpen}
              creditNote={{ id: d.id, invoice_number: d.invoice_number, supplier_id: d.supplier_id, legal_entity_id: d.legal_entity_id, notes: d.notes }} />
          </div>
        );
      })()}
    </QueryState>
  );
}
