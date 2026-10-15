import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ArrowLeft, FileText, Loader2, MoreHorizontal, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { useInvoiceDocumentUrl } from "@/fakturaer/hooks/useInvoiceDocument";
import { isFlaggable } from "@/fakturaer/lib/flagging";
import { DeliveryTimeline } from "./DeliveryTimeline";
import type { DeliveryStep, NextStep } from "./invoiceSteps";

export type HeaderMenuAction = "flag" | "unflag" | "rematch" | "fetch" | "register" | "credit" | "history" | "recheck" | "vat" | "override" | "correct" | "reread" | "facts" | "exclude";

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
  /** «Hold utenfor råvarebehandling» er tilgjengelig (skrivbar, ikke avstemt/utelatt). */
  canHoldOutside?: boolean;
  /** Tekst på tilbakeknappen («Fakturaer» eller «Å gjøre»). */
  backLabel?: string;
  /** Linjesummen avviker: vis mva-forslag og overstyring. */
  sumMismatch?: boolean;
  /** Fakturaen har linjer som kan rettes manuelt mot originalen. */
  canCorrect?: boolean;
  /** Primær arbeidsflate: én linje (tilbake, identitet, status, handlinger), samme innhold. */
  compact?: boolean;
};

/** Sticky header: hvem/hva, leveransestatus og ÉN primærknapp for neste steg. */
export function WorkspaceHeader(p: Props) {
  const doc = useInvoiceDocumentUrl(p.docPath);
  const final = p.status === "reconciled";
  const excluded = p.status === "excluded";
  return (
    <header className={cn("sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur", p.compact ? "flex flex-wrap items-center gap-x-3 gap-y-1 py-1" : "space-y-2 py-3")}>
      <div className={cn("flex flex-wrap items-center gap-2", p.compact && "shrink-0")}>
        <Button asChild variant="ghost" size="sm" className="-ml-2 min-h-[44px] gap-1.5">
          <Link to={p.backHref}><ArrowLeft className="h-4 w-4" aria-hidden />{p.backLabel ?? "Fakturaer"}</Link>
        </Button>
        {p.undoLabel && (
          <Button variant="ghost" size="sm" className="min-h-[44px] gap-1.5" onClick={p.onUndo}>
            <Undo2 className="h-4 w-4" aria-hidden />Angre «{p.undoLabel}»
          </Button>
        )}
      </div>
      <div className={cn("flex flex-wrap justify-between", p.compact ? "min-w-0 flex-1 items-center gap-2" : "items-end gap-3")}>
        <div className={cn("min-w-0", p.compact ? "flex flex-wrap items-center gap-x-3 gap-y-0.5" : "space-y-1")}>
          <h2 className={cn("font-serif leading-tight", p.compact ? "text-base" : "text-xl")}>{p.supplier} · Faktura {p.invoiceNumber}</h2>
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
            <Button variant={p.docOpen ? "secondary" : "outline"} size="sm" className="min-h-[44px] gap-1.5" onClick={p.onToggleDoc} aria-pressed={p.docOpen}>
              <FileText className="h-4 w-4" aria-hidden />{p.docOpen ? "Skjul dokument" : "Vis dokument"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-[44px] w-[44px]" aria-label="Flere valg for fakturaen"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {p.canWrite && isFlaggable(p.status) && <DropdownMenuItem onSelect={() => p.onMenu("flag")}>Flagg …</DropdownMenuItem>}
              {p.canWrite && p.status === "flagged" && <DropdownMenuItem onSelect={() => p.onMenu("unflag")}>Fjern flagg …</DropdownMenuItem>}
              {p.canWrite && !final && (
                <DropdownMenuItem disabled={p.rematchBusy} onSelect={() => p.onMenu("rematch")}>Beregn på nytt</DropdownMenuItem>
              )}
              {p.canWrite && p.canFetch && <DropdownMenuItem onSelect={() => p.onMenu("fetch")}>Hent linjer</DropdownMenuItem>}
              {p.canWrite && !final && !p.canCorrect && <DropdownMenuItem onSelect={() => p.onMenu("register")}>Registrer linjer</DropdownMenuItem>}
              {p.canWrite && !final && p.canCorrect && p.docPath && <DropdownMenuItem onSelect={() => p.onMenu("reread")}>Les originalen på nytt …</DropdownMenuItem>}
              {p.canWrite && !final && p.canCorrect && <DropdownMenuItem onSelect={() => p.onMenu("correct")}>Rett linjer mot originalen …</DropdownMenuItem>}
              <DropdownMenuSeparator />
              {p.sumMismatch && <DropdownMenuItem onSelect={() => p.onMenu("facts")}>Vis sumkontroll</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => p.onMenu("recheck")}>Kontroller summen på nytt</DropdownMenuItem>
              {p.canWrite && p.sumMismatch && <DropdownMenuItem onSelect={() => p.onMenu("vat")}>Forslag ved mva-avvik</DropdownMenuItem>}
              {p.canWrite && p.sumMismatch && !final && <DropdownMenuItem onSelect={() => p.onMenu("override")}>Overstyr sumavvik med begrunnelse …</DropdownMenuItem>}
              {p.canWrite && p.isCreditNote && !excluded && <DropdownMenuItem onSelect={() => p.onMenu("credit")}>Koble kreditnota</DropdownMenuItem>}
              {p.canHoldOutside && <DropdownMenuItem onSelect={() => p.onMenu("exclude")}>Hold utenfor råvarebehandling …</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!doc.url} onSelect={() => { if (doc.url) window.open(doc.url, "_blank", "noopener,noreferrer"); }}>
                Originalfaktura i ny fane
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => p.onMenu("history")}>Revisjonshistorikk</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!excluded && <Button size="sm" className="hidden min-h-[44px] sm:inline-flex" data-primary-action disabled={!p.next.enabled || p.busy} title={p.next.hint} onClick={p.onPrimary}>
            {p.busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            {p.next.label}
          </Button>}
        </div>
      </div>
      <p className={cn("hidden text-right text-caption sm:block text-ink-secondary", p.compact && "w-full truncate")} aria-live="polite">{p.rematchNote ? `${p.rematchNote} · ` : ""}{p.next.hint}</p>
    </header>
  );
}
