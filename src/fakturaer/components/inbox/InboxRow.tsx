import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, MoreHorizontal } from "lucide-react";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { inboxPrimaryAction, type InboxPrimaryAction } from "@/fakturaer/lib/inbox";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";

interface Props {
  invoice: InboxInvoice;
  canWrite: boolean;
  canReconcile: boolean;
  busy: boolean;
  onPrimary: (action: InboxPrimaryAction) => void;
  onRematch: () => void;
  onOpenDetail: () => void;
  onFlag: () => void;
}

/** Én rolig rad: leverandør først, ÉN handling, én kort forklaring. */
export function InboxRow({ invoice, canWrite, canReconcile, busy, onPrimary, onRematch, onOpenDetail, onFlag }: Props) {
  const done = invoice.status === "reconciled";
  const primary = inboxPrimaryAction(invoice);
  const a = invoice.assessment;
  const total = invoice.line_count;
  const allowed =
    primary.action === "finish" ? canReconcile : primary.action === "resolve" ? true : canWrite;

  return (
    <li className="flex flex-col gap-2 border-b border-line-subtle px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium">{invoice.supplier_name ?? "Ukjent leverandør"}</span>
          {invoice.is_credit_note && <span className="text-caption text-warning">Kreditnota</span>}
        </div>
        <div className="truncate text-caption text-ink-secondary">
          {invoice.invoice_number} · {formatDate(invoice.invoice_date)}
          {!done && <> · {primary.hint}</>}
        </div>
        {!done && total > 0 && (
          <div
            className="mt-1.5 h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`${a.doneCount} av ${total} linjer avklart`}
            aria-valuenow={a.doneCount}
            aria-valuemin={0}
            aria-valuemax={total}
          >
            <div className="h-full bg-primary" style={{ width: `${Math.round((a.doneCount / total) * 100)}%` }} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <span className="tabular-nums text-sm">{formatNok(invoice.total_amount)}</span>
        <div className="flex items-center gap-1">
          {done ? (
            <Button size="sm" variant="outline" onClick={onOpenDetail}>
              Vis
            </Button>
          ) : (
            <Button
              size="sm"
              variant={primary.action === "finish" ? "default" : "outline"}
              onClick={() => onPrimary(primary.action)}
              disabled={busy || !allowed}
              className="min-w-[8.5rem]"
            >
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {primary.label}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Flere valg for ${invoice.invoice_number}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpenDetail}>Åpne detaljside</DropdownMenuItem>
              {canWrite && !done && total > 0 && invoice.status !== "flagged" && (
                <DropdownMenuItem onSelect={onRematch}>Kjør matching på nytt</DropdownMenuItem>
              )}
              {canWrite && !done && invoice.status !== "flagged" && (
                <DropdownMenuItem onSelect={onFlag}>Flagg fakturaen</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
