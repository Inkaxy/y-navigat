import { AlertTriangle, CheckCircle2, Clock, Package, Paperclip, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { REQUEST_TYPE_LABEL, type RequestType } from "@/ordre/lib/aiSuggestion";
import {
  formatTicketRelative,
  formatTicketTimeShort,
  ticketInitials,
  TICKET_PRIORITY_LABEL,
} from "@/ordre/lib/ticketFormat";
import type { TicketPriority } from "@/ordre/hooks/useTickets";

export type InboxRow = {
  id: string;
  subject: string | null;
  body_preview: string | null;
  sender_name: string | null;
  sender_email: string;
  received_at: string;
  updated_at: string;
  status: "new" | "in_progress" | "resolved" | "closed" | "spam";
  priority: TicketPriority;
  assigned_to: string | null;
  has_attachments: boolean;
  related_order_id: string | null;
  orders?: { order_number: string | null; status?: string | null } | null;
  intent: RequestType | null;
  overdue: boolean;
  countdown: string | null;
  deadline: Date | null;
  awaitingCustomer: boolean;
};

/** Kort, handlingsrettet neste-steg basert på tilstanden saken faktisk er i. */
export function nextActionLabel(row: InboxRow): string {
  if (row.status === "resolved") return "Ferdig — kan lukkes";
  if (row.awaitingCustomer) return "Venter på kunde";
  if (!row.assigned_to) return "Trenger ansvarlig";
  if (!row.related_order_id && row.intent !== "question") return "Koble til ordre";
  return "Svar kunden";
}

/**
 * Én rad i arbeidslisten. Prioriterer kundeidentitet, hva kunden vil,
 * utdrag, ordrekobling, ventetid og neste handling — i den rekkefølgen.
 */
export default function TicketListRow({
  row,
  active,
  selected,
  assigneeName,
  onSelectChange,
  onOpen,
  onAssignMe,
  onResolve,
  canWrite,
}: {
  row: InboxRow;
  active: boolean;
  selected: boolean;
  assigneeName: string | null;
  onSelectChange: (checked: boolean) => void;
  onOpen: () => void;
  onAssignMe: () => void;
  onResolve: () => void;
  canWrite: boolean;
}) {
  const customer = row.sender_name || row.sender_email;
  const intent = row.intent ? REQUEST_TYPE_LABEL[row.intent] : "Ukategorisert";

  return (
    <li
      data-ticket-row={row.id}
      className={cn(
        "group relative flex items-start gap-2.5 border-b border-border px-3 py-2.5 transition-colors",
        active ? "bg-primary/5" : "hover:bg-muted/50",
        row.status === "new" && "border-l-2 border-l-primary",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(v) => onSelectChange(v === true)}
        aria-label={`Velg henvendelse fra ${customer}`}
        className="relative z-10 mt-1"
      />

      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{customer}</span>
          {row.priority !== "normal" && (
            <StatusPill
              label={TICKET_PRIORITY_LABEL[row.priority]}
              tokenVar={
                row.priority === "urgent" || row.priority === "high"
                  ? "--state-danger"
                  : "--state-neutral"
              }
              size="sm"
              hideDot
            />
          )}
          {row.has_attachments && (
            <Paperclip
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-label="Har vedlegg"
            />
          )}
          <span
            className="ml-auto shrink-0 text-caption text-muted-foreground"
            title={formatTicketRelative(row.received_at)}
          >
            {formatTicketTimeShort(row.received_at)}
          </span>
        </span>

        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-sm text-foreground">
            {row.subject || "(uten emne)"}
          </span>
        </span>

        <span className="mt-0.5 block truncate text-caption text-muted-foreground">
          {row.body_preview || row.sender_email}
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusPill label={intent} tokenVar="--state-info" size="sm" />
          {row.countdown && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-caption font-medium",
                row.overdue
                  ? "border-[hsl(var(--state-danger))]/40 bg-[hsl(var(--state-danger))]/10 text-[hsl(var(--state-danger))]"
                  : "border-border bg-muted text-muted-foreground",
              )}
              title={row.deadline ? `Frist ${row.deadline.toLocaleString("nb-NO")}` : undefined}
            >
              {row.overdue ? (
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Clock className="h-3 w-3" aria-hidden="true" />
              )}
              {row.countdown}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
            <UserCheck className="h-3 w-3" aria-hidden="true" />
            {row.assigned_to ? (assigneeName ?? "Ukjent bruker") : "Uten ansvarlig"}
          </span>
          <span className="text-caption font-medium text-primary">
            → {nextActionLabel(row)}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {row.related_order_id && row.orders?.order_number ? (
          <Link
            to={`/ordre/ordrer/${row.related_order_id}`}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 inline-flex items-center gap-1 rounded-[8px] border border-border bg-background px-1.5 py-0.5 text-caption font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Package className="h-3 w-3" aria-hidden="true" />#{row.orders.order_number}
          </Link>
        ) : (
          <span className="rounded-[8px] border border-dashed border-border px-1.5 py-0.5 text-caption text-muted-foreground">
            Ingen ordre
          </span>
        )}

        <span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-caption font-semibold text-muted-foreground"
          title={row.assigned_to ? `Ansvarlig: ${assigneeName ?? "Ukjent"}` : "Uten ansvarlig"}
        >
          {row.assigned_to ? ticketInitials(assigneeName, "?") : "—"}
        </span>

        {/* Hover-/fokushandlinger — alltid synlige for tastaturbrukere. */}
        <span className="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={onAssignMe}
            disabled={!canWrite}
            aria-label={`Ta saken fra ${customer} selv`}
            className="rounded-[8px] border border-border bg-background p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onResolve}
            disabled={!canWrite}
            aria-label={`Ferdigbehandle saken fra ${customer}`}
            className="rounded-[8px] border border-border bg-background p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
    </li>
  );
}
