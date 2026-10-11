import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InvoiceFactsView } from "@/fakturaer/components/invoice-detail/InvoiceFactsCard";
import type { InvoiceDetailData } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";
import { formatNok } from "@/fakturaer/lib/constants";
import { parseReadIssues } from "@/fakturaer/lib/lineCorrection";
import { cn } from "@/lib/utils";
import { headerFacts } from "./InvoiceFactsSection";
import { ReadIssuesBanner } from "./ReadIssuesBanner";
import { sumOk, sumStatusLabel } from "./invoiceSteps";

type Props = {
  data: InvoiceDetailData;
  openCount: number;
  totalCount: number;
  canWrite: boolean;
  locked: boolean;
  /** Øk for å åpne detaljene utenfra (f.eks. «Rett sumavvik»). */
  openSignal: number;
  /** Mobil «Kontroll»-fane: detaljene alltid åpne. */
  expanded?: boolean;
};

export type ControlFigures = { net: number | null; linesSum: number | null; diff: number | null };

/** Netto fra fakturaen, lest linjesum og differansen — null når et tall mangler. */
export function controlFigures(d: Pick<InvoiceDetailData, "total_amount" | "total_vat" | "lines_sum_excl_vat">): ControlFigures {
  const net = d.total_amount != null ? Number(d.total_amount) - Number(d.total_vat ?? 0) : null;
  const linesSum = d.lines_sum_excl_vat != null ? Number(d.lines_sum_excl_vat) : null;
  return { net, linesSum, diff: net != null && linesSum != null ? Math.round((linesSum - net) * 100) / 100 : null };
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "warning" | "success" | "muted" }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-secondary">{label}</dt>
      <dd className={cn("truncate text-sm font-medium tabular-nums", tone === "warning" && "text-warning", tone === "success" && "text-success", tone === "muted" && "text-ink-secondary")}>{value}</dd>
    </div>
  );
}

/** ÉN kontrollblokk: netto, lest sum, differanse og gjenstående — detaljer og lesevarsler bak «Detaljer». */
export function ControlSummary({ data, openCount, totalCount, canWrite, locked, openSignal, expanded }: Props) {
  const invIssues = parseReadIssues(data.extraction_issues);
  const lineIssues = (data.invoice_lines ?? []).filter((l) => l.match_confidence !== "not_applicable" && parseReadIssues(l.extraction_issues).length > 0).length;
  const extractionFailed = data.line_extraction_status === "failed" && !!data.line_extraction_error;
  const needsAttention = data.lines_sum_status === "mismatch" || invIssues.length > 0 || lineIssues > 0 || extractionFailed;
  const [open, setOpen] = useState(needsAttention);
  useEffect(() => { if (openSignal > 0) setOpen(true); }, [openSignal]);
  const f = controlFigures(data);
  const checked = sumOk(data.lines_sum_status);
  const readNote = extractionFailed
    ? `Linjene kunne ikke hentes (forsøk ${Math.min(data.line_extraction_attempts ?? 0, 3)}/3)`
    : invIssues.length + lineIssues > 0
      ? `Lesingen må kontrolleres: ${[invIssues.length > 0 ? "fakturavarsel" : null, lineIssues > 0 ? `${lineIssues} ${lineIssues === 1 ? "linje" : "linjer"} med lesevarsel` : null].filter(Boolean).join(", ")}`
      : null;

  return (
    <Collapsible open={expanded || open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card">
      <div className="space-y-2 px-4 py-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Figure label="Netto på fakturaen" value={formatNok(f.net)} />
          <Figure label="Lest linjesum" value={formatNok(f.linesSum)} />
          <Figure label={sumStatusLabel(data.lines_sum_status)} value={f.diff == null ? "—" : `${f.diff > 0 ? "+" : ""}${formatNok(f.diff)}`}
            tone={data.lines_sum_status === "mismatch" ? "warning" : checked ? "success" : "muted"} />
          <Figure label="Gjenstår" value={totalCount === 0 ? "—" : openCount === 0 ? "Alle avklart" : `${openCount} av ${totalCount} linjer`} tone={openCount > 0 ? "warning" : undefined} />
        </dl>
        <div className="flex items-center justify-between gap-2">
          <p className={cn("min-w-0 text-xs", readNote ? "text-warning" : "text-ink-secondary")}>
            {readNote ?? (checked ? "Linjesummen er kontrollert mot fakturaen." : "Linjesummen er ikke kontrollert mot fakturaen ennå.")}
          </p>
          {!expanded && (
            <CollapsibleTrigger className="flex shrink-0 items-center gap-1 rounded-sm text-caption text-ink-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Detaljer<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            </CollapsibleTrigger>
          )}
        </div>
      </div>
      <CollapsibleContent className="space-y-3 border-t border-border p-3">
        {extractionFailed && <p role="alert" className="text-sm text-destructive">{data.line_extraction_error}</p>}
        <ReadIssuesBanner invoiceId={data.id} issues={invIssues} lineIssueCount={lineIssues} canWrite={canWrite} locked={locked} />
        <InvoiceFactsView invoice={data} details={headerFacts(data)} />
      </CollapsibleContent>
    </Collapsible>
  );
}
