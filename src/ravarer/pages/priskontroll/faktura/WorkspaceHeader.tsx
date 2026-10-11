import { Link } from "react-router-dom";
import { ArrowLeft, FileText, Loader2, MoreHorizontal, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { useInvoiceDocumentUrl } from "@/fakturaer/hooks/useInvoiceDocument";
import { isFlaggable } from "@/fakturaer/lib/flagging";
import { DeliveryTimeline } from "./DeliveryTimeline";
import type { DeliveryStep, NextStep } from "./invoiceSteps";

export type HeaderMenuAction = "flag" | "unflag" | "rematch" | "fetch" | "register" | "credit" | "history";

type Props = {
  backHref: string;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  amount: number | null;
  status: string;
  reconciledMode: string | null;
  steps: DeliveryStep[];
  isCreditNote: boolean;
  next: NextStep;
  busy: boolean;
  onPrimary: () => void;
  undoLabel: string | null;
  onUndo: () => void;
  docPath: string | null;
  docOpen: boolean;
  onToggleDoc: () => void;
  canWrite: boolean;
  /** «Hent linjer» gjør noe (Tripletex og linjene er ikke lest ennå). */
  canFetch: boolean;
  rematchBusy: boolean;
  /** Køstatus mens «Beregn på nytt» venter. */
  rematchNote?: string | null;
  /** «N av M linjer avklart». */
  lineProgress?: { done: number; total: number } | null;
  onMenu: (a: HeaderMenuAction) => void;
};

/** Sticky header: hvem/hva, leveransestatus og ÉN primærknapp for neste steg. */
export function WorkspaceHeader(p: Props) {
  const doc = useInvoiceDocumentUrl(p.docPath);
  const final = p.status === "reconciled";
  return (
    <header className="sticky top-0 z-20 space-y-2 border-b border-border bg-background/95 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
          <Link to={p.backHref}><ArrowLeft className="h-4 w-4" aria-hidden />Fakturaer</Link>
        </Button>
        {p.undoLabel && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={p.onUndo}>
            <Undo2 className="h-4 w-4" aria-hidden />Angre «{p.undoLabel}»
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="font-serif text-xl leading-tight">{p.supplier} · Faktura {p.invoiceNumber}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-secondary">
            <span>{formatDate(p.invoiceDate)}</span>
            <span className="tabular-nums">{formatNok(p.amount)}</span>
            <InvoiceStatusBadge status={p.status} reconciledMode={p.reconciledMode} />
            <DeliveryTimeline steps={p.steps} flagged={p.status === "flagged"} creditNote={p.isCreditNote} />
            {p.lineProgress && p.lineProgress.total > 0 && (
              <span className="tabular-nums" aria-label={`${p.lineProgress.done} av ${p.lineProgress.total} linjer avklart`}>
                {p.lineProgress.done} av {p.lineProgress.total} linjer avklart
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.docPath && (
            <Button variant={p.docOpen ? "secondary" : "outline"} size="sm" className="gap-1.5" onClick={p.onToggleDoc} aria-pressed={p.docOpen}>
              <FileText className="h-4 w-4" aria-hidden />{p.docOpen ? "Skjul dokument" : "Vis dokument"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Flere valg for fakturaen"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {p.canWrite && isFlaggable(p.status) && <DropdownMenuItem onSelect={() => p.onMenu("flag")}>Flagg …</DropdownMenuItem>}
              {p.canWrite && p.status === "flagged" && <DropdownMenuItem onSelect={() => p.onMenu("unflag")}>Fjern flagg …</DropdownMenuItem>}
              {p.canWrite && !final && (
                <DropdownMenuItem disabled={p.rematchBusy} onSelect={() => p.onMenu("rematch")}>Beregn på nytt</DropdownMenuItem>
              )}
              {p.canWrite && p.canFetch && <DropdownMenuItem onSelect={() => p.onMenu("fetch")}>Hent linjer</DropdownMenuItem>}
              {p.canWrite && !final && <DropdownMenuItem onSelect={() => p.onMenu("register")}>Registrer linjer</DropdownMenuItem>}
              {p.canWrite && p.isCreditNote && <DropdownMenuItem onSelect={() => p.onMenu("credit")}>Koble kreditnota</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!doc.url} onSelect={() => { if (doc.url) window.open(doc.url, "_blank", "noopener,noreferrer"); }}>
                Originalfaktura i ny fane
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => p.onMenu("history")}>Revisjonshistorikk</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" data-primary-action disabled={!p.next.enabled || p.busy} title={p.next.hint} onClick={p.onPrimary}>
            {p.busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            {p.next.label}
          </Button>
        </div>
      </div>
      <p className="text-right text-caption text-ink-secondary" aria-live="polite">{p.rematchNote ? `${p.rematchNote} · ` : ""}{p.next.hint}</p>
    </header>
  );
}
