import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Flag, Link2, Loader2, RefreshCw } from "lucide-react";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { INBOX_ISSUE_LABELS } from "@/fakturaer/lib/inbox";
import { canDoInvoiceAction, invoiceActionBlockedReason } from "@/fakturaer/lib/statusGuards";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { cn } from "@/lib/utils";

interface Props {
  invoice: InboxInvoice;
  expanded: boolean;
  canWrite: boolean;
  canReconcile: boolean;
  busyAction: string | null;
  onToggle: () => void;
  onFetchLines: () => void;
  onRunMatch: () => void;
  onReconcile: () => void;
  onUnflag: () => void;
  onLinkCreditNote: () => void;
  onOpen: () => void;
}

/** Ett fakturakort i innboksen: hva står igjen, og hva kan gjøres nå. */
export function InboxInvoiceCard({
  invoice,
  expanded,
  canWrite,
  canReconcile,
  busyAction,
  onToggle,
  onFetchLines,
  onRunMatch,
  onReconcile,
  onUnflag,
  onLinkCreditNote,
  onOpen,
}: Props) {
  const a = invoice.assessment;
  const status = invoice.status;
  const showFetchLines =
    canWrite &&
    canDoInvoiceAction(status, "fetch_lines") &&
    (invoice.line_count === 0 || ["pending", "failed"].includes(invoice.line_extraction_status ?? ""));
  const matchBlocked = invoiceActionBlockedReason(status, "match");
  const reconcileTooltip = a.reconcileBlockedReason ?? "Bekreft at alle linjer er korrekt matchet og priset";

  return (
    <Card className={cn("overflow-hidden", expanded && "ring-1 ring-primary/30")}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle} aria-label={expanded ? "Skjul linjer" : "Vis linjer"}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>

        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{invoice.invoice_number}</span>
            <InvoiceStatusBadge status={status} />
            {invoice.is_credit_note && (
              <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                Kreditnota
              </Badge>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-secondary">
            {invoice.supplier_name ?? "Ukjent leverandør"} • {formatDate(invoice.invoice_date)} •{" "}
            {formatNok(invoice.total_amount)} • {invoice.line_count} linjer
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {a.issues.length === 0 ? (
            <Badge variant="outline" className="border-success/40 bg-success/10 text-[10px] text-success">
              Klar
            </Badge>
          ) : (
            a.issues.map((i) => (
              <Badge key={i} variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                {INBOX_ISSUE_LABELS[i]}
              </Badge>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {showFetchLines && (
            <Button size="sm" variant="outline" onClick={onFetchLines} disabled={busyAction === "fetch"} className="gap-1.5">
              {busyAction === "fetch" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Hent linjer
            </Button>
          )}

          {canWrite && !matchBlocked && invoice.line_count > 0 && (
            <Button size="sm" variant="outline" onClick={onRunMatch} disabled={busyAction === "match"} className="gap-1.5">
              {busyAction === "match" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Kjør match
            </Button>
          )}

          {canWrite && a.issues.includes("credit_note_unlinked") && (
            <Button size="sm" variant="outline" onClick={onLinkCreditNote} className="gap-1.5">
              <Link2 className="h-3.5 w-3.5" /> Knytt til faktura
            </Button>
          )}

          {canWrite && canDoInvoiceAction(status, "unflag") && (
            <Button size="sm" variant="outline" onClick={onUnflag} disabled={busyAction === "unflag"} className="gap-1.5">
              {busyAction === "unflag" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flag className="h-3.5 w-3.5" />}
              Fjern flagg
            </Button>
          )}

          {canReconcile && canDoInvoiceAction(status, "reconcile") && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button size="sm" onClick={onReconcile} disabled={!a.canReconcile} className="gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Avstem
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent><span className="max-w-xs">{reconcileTooltip}</span></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <Button size="sm" variant="ghost" onClick={onOpen} className="gap-1.5" aria-label="Åpne fakturaen">
            <ExternalLink className="h-3.5 w-3.5" /> Åpne
          </Button>
        </div>
      </div>
    </Card>
  );
}
