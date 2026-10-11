import { Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { inboxPrimaryAction, type InboxPrimaryAction } from "@/fakturaer/lib/inbox";

export type RowAction = InboxPrimaryAction | "open" | "rematch" | "flag" | "unflag";

type Props = {
  inv: InboxInvoice;
  canWrite: boolean;
  canReconcile: boolean;
  busy: boolean;
  onAction: (inv: InboxInvoice, a: RowAction) => void;
};

/** Hovedknapp (som innboksen) + meny «…». Klikk her åpner ikke raden. */
export function FakturaRowActions({ inv, canWrite, canReconcile, busy, onAction }: Props) {
  const done = inv.status === "reconciled";
  const primary = inboxPrimaryAction(inv);
  const allowed = primary.action === "finish" ? canReconcile : primary.action === "resolve" || primary.action === "view_flag" ? true : canWrite;
  const flagged = inv.status === "flagged";
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {done ? (
        <Button size="sm" variant="outline" onClick={() => onAction(inv, "open")}>Åpne</Button>
      ) : (
        <Button size="sm" variant={primary.action === "finish" ? "default" : "outline"} disabled={busy || !allowed} title={primary.hint} onClick={() => onAction(inv, primary.action)}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
          {primary.label}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Flere valg for faktura ${inv.invoice_number}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onAction(inv, "open")}>Åpne</DropdownMenuItem>
          {canWrite && !done && inv.line_count > 0 && !flagged && (
            <DropdownMenuItem onSelect={() => onAction(inv, "rematch")}>Kjør matching på nytt</DropdownMenuItem>
          )}
          {canWrite && !done && !flagged && <DropdownMenuItem onSelect={() => onAction(inv, "flag")}>Flagg …</DropdownMenuItem>}
          {canWrite && flagged && <DropdownMenuItem onSelect={() => onAction(inv, "unflag")}>Fjern flagg …</DropdownMenuItem>}
          {canWrite && !done && (
            <>
              <DropdownMenuSeparator />
              {inv.source === "tripletex" && <DropdownMenuItem onSelect={() => onAction(inv, "fetch_lines")}>Hent linjer</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => onAction(inv, "register_lines")}>Registrer linjer</DropdownMenuItem>
              {inv.is_credit_note && <DropdownMenuItem onSelect={() => onAction(inv, "link_credit_note")}>Koble kreditnota</DropdownMenuItem>}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
