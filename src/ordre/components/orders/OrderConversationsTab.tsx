import { Link } from "react-router-dom";
import { MessageSquare, ArrowUpRight, Paperclip, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  formatTicketTime,
  formatTicketTimeShort,
  formatTicketRelative,
  ticketInitials,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_STYLE,
} from "@/ordre/lib/ticketFormat";
import {
  normalizeAiSuggestion,
  REQUEST_TYPE_LABEL,
  REQUEST_TYPE_BADGE,
} from "@/ordre/lib/aiSuggestion";
import {
  useOrderConversations,
  type OrderConversation,
} from "@/ordre/hooks/useOrderConversations";
import { TimelineCard } from "@/ordre/components/orders/TimelineCard";
import type { TicketStatus } from "@/ordre/hooks/useTickets";


function ConversationRow({ t }: { t: OrderConversation }) {
  const status: TicketStatus = t.awaiting_internal ? "in_progress" : t.status;
  const displayStatus: string = t.awaiting_internal
    ? "Venter internt"
    : TICKET_STATUS_LABEL[t.status];
  const ai = normalizeAiSuggestion(t.ai_suggestion);
  const intent = ai?.request_type ?? null;
  const senderLabel = t.sender_name || t.sender_email;

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-3 first:border-t-0 hover:bg-accent/40">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-[11px]">
          {ticketInitials(senderLabel, t.sender_email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {intent && (
            <Badge
              variant="outline"
              className={cn("text-[10px]", REQUEST_TYPE_BADGE[intent])}
            >
              {REQUEST_TYPE_LABEL[intent]}
            </Badge>
          )}
          <span className="truncate font-medium text-sm">
            {t.subject || "(uten emne)"}
          </span>
          {t.has_attachments && (
            <Paperclip className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="truncate">{senderLabel}</span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {t.message_count}
          </span>
          <span title={formatTicketRelative(t.last_activity_at)}>
            Sist aktivitet {formatTicketTimeShort(t.last_activity_at)}
          </span>
          <span title="Mottatt">{formatTicketTime(t.received_at)}</span>
        </div>
      </div>
      <Badge
        variant="outline"
        className={cn("text-[10px] shrink-0", TICKET_STATUS_STYLE[status])}
      >
        {displayStatus}
      </Badge>
      <Button asChild size="sm" variant="outline" className="gap-1 shrink-0">
        <Link to={`/ordre/ticket/${t.id}`}>
          Åpne samtalen
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}

export function OrderConversationsTab({ orderId }: { orderId: string }) {
  const { data: conversations = [], isLoading } = useOrderConversations(orderId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            Koblede samtaler
            {!isLoading && (
              <Badge variant="outline" className="ml-auto text-[10px]">
                {conversations.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Ingen e-postsamtaler er koblet til denne ordren ennå.
            </p>
          ) : (
            <div>
              {conversations.map((t) => (
                <ConversationRow key={t.id} t={t} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TimelineCard orderId={orderId} title="Ordre-tidslinje" />
    </div>
  );
}

export default OrderConversationsTab;
