import { Link } from "react-router-dom";
import { MessageSquare, ArrowUpRight, Paperclip } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import {
  formatTicketTime,
  formatTicketRelative,
  TICKET_STATUS_LABEL,
} from "@/ordre/lib/ticketFormat";
import { normalizeAiSuggestion, REQUEST_TYPE_LABEL } from "@/ordre/lib/aiSuggestion";
import { isTerminalTicket } from "@/ordre/lib/ticketRowState";
import { ticketHref } from "@/ordre/lib/ticketReturn";
import {
  useOrderConversations,
  type OrderConversation,
} from "@/ordre/hooks/useOrderConversations";
import { useUserNames } from "@/ordre/hooks/useUserNames";
import { TimelineCard } from "@/ordre/components/orders/TimelineCard";

function ConversationRow({
  t,
  orderId,
  assigneeName,
}: {
  t: OrderConversation;
  orderId: string;
  assigneeName: string | null;
}) {
  const intent = normalizeAiSuggestion(t.ai_suggestion)?.request_type ?? null;
  const terminal = isTerminalTicket(t.status);
  const waiting = t.awaiting_internal
    ? "Venter internt"
    : t.awaiting_external
      ? "Venter på ekstern part"
      : null;
  const href = ticketHref(t.id, `/ordre/ordrer/${orderId}?tab=samtaler`);

  return (
    <li className="flex flex-wrap items-start gap-3 border-t border-border px-3 py-3 first:border-t-0">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={href}
            className="truncate text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.subject || "(uten emne)"}
          </Link>
          {t.has_attachments && (
            <Paperclip className="h-3 w-3 text-muted-foreground" aria-label="Har vedlegg" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill
            label={`Sak: ${TICKET_STATUS_LABEL[t.status]}`}
            tokenVar={terminal ? "--state-neutral" : "--state-info"}
            size="sm"
          />
          {waiting && <StatusPill label={waiting} tokenVar="--state-warning" size="sm" hideDot />}
          {intent && <StatusPill label={REQUEST_TYPE_LABEL[intent]} tokenVar="--state-info" size="sm" hideDot />}
          <span className="rounded border border-border bg-background px-1.5 text-caption text-muted-foreground">
            {t.relation === "primary" ? "Hovedordre for saken" : "Også koblet til saken"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
          <span className="truncate">{t.sender_name || t.sender_email}</span>
          <span>Ansvarlig: {t.assigned_to ? (assigneeName ?? "Ukjent bruker") : "ingen"}</span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            {t.message_count} meldinger
          </span>
          <span title={formatTicketRelative(t.last_activity_at)}>
            Sist aktivitet {formatTicketTime(t.last_activity_at)}
          </span>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0 gap-1">
        <Link to={href}>
          Åpne sak <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </Button>
    </li>
  );
}

export function OrderConversationsTab({ orderId }: { orderId: string }) {
  const { data: conversations = [], isLoading, isError, error, refetch, isSuccess } =
    useOrderConversations(orderId);
  const { data: names = {} } = useUserNames(conversations.map((c) => c.assigned_to));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Koblede saker
            {isSuccess && (
              <Badge variant="outline" className="ml-auto text-[10px]">
                {conversations.length}
              </Badge>
            )}
          </CardTitle>
          <p className="text-caption text-muted-foreground">
            Sakens status gjelder behandlingen av henvendelsen. En løst sak betyr ikke at ordren er
            levert.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            error={error}
            scope="ordre:ordre:samtaler"
            onRetry={() => void refetch()}
            errorTitle="Kunne ikke hente koblede saker"
            isEmpty={conversations.length === 0}
            emptyTitle="Ingen saker er koblet til denne ordren"
            emptyDescription="Koble en henvendelse fra innboksen for å se den her."
            skeletonRows={3}
            compact
          >
            <ul>
              {conversations.map((t) => (
                <ConversationRow
                  key={t.id}
                  t={t}
                  orderId={orderId}
                  assigneeName={t.assigned_to ? (names[t.assigned_to] ?? null) : null}
                />
              ))}
            </ul>
          </QueryState>
        </CardContent>
      </Card>

      <TimelineCard orderId={orderId} title="Ordre-tidslinje" />
    </div>
  );
}

export default OrderConversationsTab;
