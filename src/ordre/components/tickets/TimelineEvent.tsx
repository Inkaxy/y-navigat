import { cn } from "@/lib/utils";
import { eventLabel } from "@/ordre/lib/ticketEvents";
import { formatTicketTimeShort, formatTicketRelative } from "@/ordre/lib/ticketFormat";

export interface TimelineEventRow {
  id: string;
  event_type: string;
  summary: string | null;
  actor_label: string | null;
  actor_user_id?: string | null;
  occurred_at: string;
}

/**
 * Diskret én-linjes hendelse mellom innleggene i tråden.
 * Aldri rå event_type-kode i UI — alt oversettes via EVENT_LABEL.
 */
export default function TimelineEvent({
  event,
  actorName,
  className,
}: {
  event: TimelineEventRow;
  /** Oppslått visningsnavn for actor_user_id. */
  actorName?: string | null;
  className?: string;
}) {
  const label = eventLabel(event.event_type);
  const actor = actorName || event.actor_label || null;
  const text = event.summary || label;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className="text-[10px] text-muted-foreground/70">
        ●
      </span>
      {actor && <span className="font-medium text-foreground">{actor}</span>}
      <span>{text}</span>
      <span aria-hidden="true">·</span>
      <time
        dateTime={event.occurred_at}
        title={formatTicketRelative(event.occurred_at)}
        className="tabular-nums"
      >
        {formatTicketTimeShort(event.occurred_at)}
      </time>
    </div>
  );
}
