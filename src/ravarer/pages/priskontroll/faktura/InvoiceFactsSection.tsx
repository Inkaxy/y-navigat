import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InvoiceFactsCard } from "@/fakturaer/components/invoice-detail/InvoiceFactsCard";
import { INVOICE_SOURCES } from "@/fakturaer/lib/constants";
import type { InvoiceDetailData } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";
import { LinesSumMismatchAlert } from "@/fakturaer/components/LinesSumMismatchAlert";
import { confidenceLabel, linesSourceLabel } from "@/fakturaer/lib/invoiceFacts";
import { recheckInvoiceLinesSum } from "@/fakturaer/lib/linesSum";
import { cn } from "@/lib/utils";

type Props = {
  data: InvoiceDetailData;
  canWrite: boolean;
  fetchingLines: boolean;
  onFetchLines: () => void;
  onChanged: () => void;
  /** Øk for å åpne kortet utenfra («Rett sumavvik»). */
  openSignal: number;
};

/** Én oppsummeringslinje når kortet er lukket. */
export function factsSummary(d: Pick<InvoiceDetailData, "lines_sum_status" | "lines_source" | "extraction_confidence">): string {
  const sum = d.lines_sum_status === "mismatch" ? "Sum stemmer ikke" : d.lines_sum_status == null ? "Sum ikke kontrollert" : "Sum stemmer";
  const parts = [sum, linesSourceLabel(d.lines_source).toLowerCase()];
  if (d.extraction_confidence != null) parts.push(`${confidenceLabel(Number(d.extraction_confidence)).toLowerCase()} sikkerhet`);
  return parts.join(" · ");
}

/** Feltene som tidligere sto i «Detaljer» — nå del av faktakortet, så hvert felt vises én gang. */
export function headerFacts(d: InvoiceDetailData) {
  return {
    supplierName: d.suppliers?.name ?? null,
    orgNumber: d.suppliers?.org_number ?? null,
    invoiceDate: d.invoice_date,
    dueDate: d.due_date,
    sourceLabel: INVOICE_SOURCES.find((s) => s.value === d.source)?.label ?? d.source ?? null,
  };
}

/** «Tripletex mot faktura» — fakta vist ÉN gang, øverst i linjesonen. */
export function InvoiceFactsSection({ data, canWrite, fetchingLines, onFetchLines, onChanged, openSignal }: Props) {
  const mismatch = data.lines_sum_status === "mismatch";
  const extractionFailed = data.line_extraction_status === "failed" && !!data.line_extraction_error;
  const lowConfidence = data.extraction_confidence != null && Number(data.extraction_confidence) < 0.7;
  const final = data.status === "reconciled" || data.status === "flagged";
  const [open, setOpen] = useState(mismatch || extractionFailed);
  useEffect(() => { if (openSignal > 0) setOpen(true); }, [openSignal]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm">
        <span className="min-w-0">
          <span className="font-medium">Tripletex mot faktura</span>
          <span className={cn("ml-2 text-ink-secondary", mismatch && "text-warning")}>{factsSummary(data)}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-border p-3">
        {extractionFailed && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <span className="font-medium">Kunne ikke hente fakturalinjer (forsøk {Math.min(data.line_extraction_attempts ?? 0, 3)}/3).</span> {data.line_extraction_error}
          </div>
        )}
        {lowConfidence && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <span className="font-medium">Lest med lav sikkerhet ({Math.round(Number(data.extraction_confidence) * 100)} %).</span> Kontroller beløp, dato og varelinjer mot originalen før du avstemmer.
          </div>
        )}
        {mismatch && (
          <LinesSumMismatchAlert
            invoiceId={data.id}
            linesSum={data.lines_sum_excl_vat}
            totalAmount={data.total_amount}
            totalVat={data.total_vat}
            variancePct={data.lines_sum_variance_pct}
            canOverride={canWrite && !final}
            onRecheck={async () => { await recheckInvoiceLinesSum(data.id); onChanged(); }}
            onOverridden={onChanged}
          />
        )}
        <InvoiceFactsCard invoice={data} canWrite={canWrite} fetchingLines={fetchingLines} onFetchLines={onFetchLines} details={headerFacts(data)} />
      </CollapsibleContent>
    </Collapsible>
  );
}
