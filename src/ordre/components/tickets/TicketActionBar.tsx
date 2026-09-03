import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, MoreHorizontal, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import {
  useUpdateTicket,
  type Ticket,
  type TicketStatus,
  type TicketPriority,
} from "@/ordre/hooks/useTickets";
import { useOrdrekontorAssignees } from "@/ordre/hooks/useTicketReplies";
import { TEAMS, TEAM_LABEL, type TicketTeam } from "@/ordre/lib/teams";
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUSES,
  TICKET_STATUS_LABEL,
} from "@/ordre/lib/ticketFormat";
import { logTicketEvent, type TicketEventType } from "@/ordre/lib/ticketEvents";
import TicketComposerActions from "@/ordre/components/tickets/TicketComposerActions";

const NONE = "__none__";

/**
 * Kompakt handlingsrad: status, prioritet, ansvarlig og team.
 * Alle endringer lagres umiddelbart og logges som ticket_events på norsk.
 */
export default function TicketActionBar({
  ticket,
  canWrite,
  linkedOrderNumber,
}: {
  ticket: Ticket;
  canWrite: boolean;
  linkedOrderNumber?: string | null;
}) {
  const { user } = useAuth();
  const updateTicket = useUpdateTicket();
  const { data: assignees = [] } = useOrdrekontorAssignees();
  const [moreOpen, setMoreOpen] = useState(false);

  const nameOf = (id: string | null) =>
    (id && assignees.find((a) => a.id === id)?.display_name) || "ingen";

  const apply = async (
    patch: Partial<Ticket>,
    eventType: TicketEventType,
    summary: string,
  ) => {
    try {
      await updateTicket.mutateAsync({ id: ticket.id, patch });
      await logTicketEvent({
        ticket_id: ticket.id,
        order_id: ticket.related_order_id ?? null,
        event_type: eventType,
        actor_type: "staff",
        summary,
      });
      toast.success(summary);
    } catch (e) {
      toast.error(`Kunne ikke lagre: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onStatus = (next: TicketStatus) => {
    if (next === ticket.status) return;
    const summary = `Status endret fra ${TICKET_STATUS_LABEL[ticket.status]} til ${TICKET_STATUS_LABEL[next]}`;
    const type: TicketEventType =
      next === "resolved"
        ? "ticket.resolved"
        : ticket.status === "resolved" || ticket.status === "closed"
          ? "ticket.reopened"
          : "ticket.status_changed";
    void apply({ status: next }, type, summary);
  };

  const onPriority = (next: TicketPriority) => {
    if (next === ticket.priority) return;
    void apply(
      { priority: next },
      "ticket.priority_changed",
      `Prioritet endret fra ${TICKET_PRIORITY_LABEL[ticket.priority]} til ${TICKET_PRIORITY_LABEL[next]}`,
    );
  };

  const onAssign = (raw: string) => {
    const next = raw === NONE ? null : raw;
    if (next === ticket.assigned_to) return;
    void apply(
      { assigned_to: next } as Partial<Ticket>,
      next ? "ticket.assigned" : "ticket.unassigned",
      next
        ? `Ansvarlig endret fra ${nameOf(ticket.assigned_to)} til ${nameOf(next)}`
        : "Ansvarlig fjernet",
    );
  };

  const onTeam = (raw: string) => {
    const next = raw === NONE ? null : (raw as TicketTeam);
    if (next === ticket.assigned_team) return;
    void apply(
      { assigned_team: next } as Partial<Ticket>,
      "ticket.team_changed",
      next
        ? `Team endret til ${TEAM_LABEL[next]}`
        : "Team fjernet",
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={ticket.status} onValueChange={(v) => onStatus(v as TicketStatus)} disabled={!canWrite}>
        <SelectTrigger className="h-9 w-[168px] bg-background" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TICKET_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {TICKET_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={ticket.priority}
        onValueChange={(v) => onPriority(v as TicketPriority)}
        disabled={!canWrite}
      >
        <SelectTrigger className="h-9 w-[130px] bg-background" aria-label="Prioritet">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TICKET_PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>
              {TICKET_PRIORITY_LABEL[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={ticket.assigned_to ?? NONE}
        onValueChange={onAssign}
        disabled={!canWrite}
      >
        <SelectTrigger className="h-9 w-[190px] bg-background" aria-label="Ansvarlig">
          <SelectValue placeholder="Uten ansvarlig" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Uten ansvarlig</SelectItem>
          {assignees.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {canWrite && user?.id && ticket.assigned_to !== user.id && (
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => onAssign(user.id)}>
          <UserCheck className="h-3.5 w-3.5" /> Ta selv
        </Button>
      )}

      <Select
        value={ticket.assigned_team ?? NONE}
        onValueChange={onTeam}
        disabled={!canWrite}
      >
        <SelectTrigger className="h-9 w-[150px] bg-background" aria-label="Team">
          <SelectValue placeholder="Uten team" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Uten team</SelectItem>
          {TEAMS.map((t) => (
            <SelectItem key={t} value={t}>
              {TEAM_LABEL[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        className="h-9 gap-1.5"
        onClick={() => onStatus("resolved")}
        disabled={!canWrite || updateTicket.isPending || ticket.status === "resolved"}
      >
        <CheckCircle2 className="h-4 w-4" /> Marker som løst
      </Button>

      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!canWrite}>
            <MoreHorizontal className="h-4 w-4" /> Flere handlinger
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[420px] p-3">
          <TicketComposerActions
            ticket={ticket}
            replyText=""
            onConsumeReplyText={() => {}}
            linkedOrderNumber={linkedOrderNumber}
            show={["transfer", "forward"]}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
