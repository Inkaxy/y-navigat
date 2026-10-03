import type { MouseEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock, Package, Paperclip, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { REQUEST_TYPE_LABEL, type RequestType } from "@/ordre/lib/aiSuggestion";
import { getStatusMeta } from "@/ordre/lib/orderStatus";
import {
  formatTicketRelative,
  formatTicketTimeShort,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
} from "@/ordre/lib/ticketFormat";
import { isTerminalTicket, nextActionFor } from "@/ordre/lib/ticketRowState";
import { orderHref } from "@/ordre/lib/ticketReturn";
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
  awaiting_internal?: boolean;
  awaiting_external?: boolean;
};

/** Kort, handlingsrettet neste steg basert på tilstanden saken faktisk er i. */
export function nextActionLabel(row: InboxRow): string {
  return nextActionFor(row);
}

const ACTION_BTN =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] border border-border bg-background px-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/**
 * Én rad i arbeidslisten: kunde, emne, sakstatus, ordre og ordrestatus,
 * ansvarlig og neste handling. Avsluttede saker får ingen nedtelling eller
 * hurtighandlinger.
 */
export default function TicketListRow({
  row,
  href,
  returnFrom,
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
  href: string;
  returnFrom: string;
  active: boolean;
  selected: boolean;
  assigneeName: string | null;
  onSelectChange: (checked: boolean) => void;
  /** Kalles ved vanlig klikk. Returner true for å hindre navigasjon (peek). */
  onOpen: () => boolean;
  onAssignMe: () => void;
  onResolve: () => void;
  canWrite: boolean;
}) {
  const customer = row.sender_name || row.sender_email;
  const intent = row.intent ? REQUEST_TYPE_LABEL[row.intent] : "Ukategorisert";
  const terminal = isTerminalTicket(row.status);
  const orderMeta = row.orders?.status ? getStatusMeta(row.orders.status) : null;

  const onLinkClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (onOpen()) e.preventDefault();
  };

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

      <Link
        to={href}
        onClick={onLinkClick}
        data-ticket-link={row.id}
        aria-current={active ? "true" : undefined}
        className="min-w-0 flex-1 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{customer}</span>
          {row.priority !== "normal" && !terminal && (
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
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Har vedlegg" />
          )}
          <span
            className="ml-auto shrink-0 text-caption text-muted-foreground"
            title={formatTicketRelative(terminal ? row.updated_at : row.received_at)}
          >
            {terminal ? "Sist aktiv " : ""}
            {formatTicketTimeShort(terminal ? row.updated_at : row.received_at)}
          </span>
        </span>

        <span className="mt-0.5 block truncate text-sm text-foreground">
          {row.subject || "(uten emne)"}
        </span>

        {row.body_preview && (
          <span className="mt-0.5 line-clamp-1 text-caption text-muted-foreground">
            {row.body_preview.slice(0, 160)}
          </span>
        )}

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusPill
            label={`Sak: ${TICKET_STATUS_LABEL[row.status]}`}
            tokenVar={terminal ? "--state-neutral" : "--state-info"}
            size="sm"
          />
          {!terminal && <StatusPill label={intent} tokenVar="--state-info" size="sm" hideDot />}
          {!terminal && row.countdown && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-caption font-medium",
                row.overdue
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
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
          <span
            className={cn(
              "text-caption font-medium",
              terminal ? "text-muted-foreground" : "text-primary",
            )}
          >
            {terminal ? "" : "→ "}
            {nextActionLabel(row)}
          </span>
        </span>
      </Link>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {row.related_order_id && row.orders?.order_number ? (
          <Link
            to={orderHref(row.related_order_id, returnFrom)}
            className="relative z-10 inline-flex flex-col items-end rounded-[8px] border border-border bg-background px-1.5 py-0.5 text-caption hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Åpne ordre ${row.orders.order_number}${orderMeta ? `, ordrestatus ${orderMeta.label}` : ""}`}
          >
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Package className="h-3 w-3" aria-hidden="true" />#{row.orders.order_number}
            </span>
            {orderMeta && <span className="text-muted-foreground">Ordre: {orderMeta.label}</span>}
          </Link>
        ) : row.related_order_id ? (
          <span className="rounded-[8px] border border-border px-1.5 py-0.5 text-caption text-muted-foreground">
            Ordre koblet
          </span>
        ) : (
          <span className="rounded-[8px] border border-dashed border-border px-1.5 py-0.5 text-caption text-muted-foreground">
            Ingen ordre
          </span>
        )}

        {/* Hurtighandlinger: alltid synlige på touch, ved hover/fokus på stor skjerm. */}
        {!terminal && canWrite && (
          <span className="flex gap-1 lg:opacity-0 lg:transition-opacity lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
            <button
              type="button"
              onClick={onAssignMe}
              aria-label={`Ta saken fra ${customer} selv`}
              title="Ta selv"
              className={ACTION_BTN}
            >
              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onResolve}
              aria-label={`Ferdigbehandle saken fra ${customer}`}
              title="Ferdigbehandle"
              className={ACTION_BTN}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
