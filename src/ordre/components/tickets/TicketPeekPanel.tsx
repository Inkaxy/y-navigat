import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Inbox, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { useAuth } from "@/hooks/useAuth";
import { useUserAccess } from "@/ordre/hooks/useUserAccess";
import { useTicket } from "@/ordre/hooks/useTickets";
import { useInboundMessages } from "@/ordre/hooks/useInboundMessages";
import { useTicketReplies } from "@/ordre/hooks/useTicketReplies";
import { useInternalComments } from "@/ordre/hooks/useInternalComments";
import {
  useCustomerCard,
  useLinkedOrder,
  useTicketEvents,
} from "@/ordre/hooks/useTicketDetailData";
import { useUserNames } from "@/ordre/hooks/useUserNames";
import { normalizeAiSuggestion } from "@/ordre/lib/aiSuggestion";
import { TICKET_STATUS_LABEL } from "@/ordre/lib/ticketFormat";
import TicketIdentityCard from "@/ordre/components/tickets/TicketIdentityCard";
import OrderLinkCard from "@/ordre/components/tickets/OrderLinkCard";
import AiFieldSuggestions from "@/ordre/components/tickets/AiFieldSuggestions";
import TicketThread from "@/ordre/components/tickets/TicketThread";
import TicketComposer, {
  type TicketComposerHandle,
} from "@/ordre/components/tickets/TicketComposer";
import TicketActionBar from "@/ordre/components/tickets/TicketActionBar";
import LinkCustomerDialog from "@/ordre/components/tickets/LinkCustomerDialog";
import QuickCreateCustomerDialog from "@/ordre/components/tickets/QuickCreateCustomerDialog";

export type TicketPeekHandle = {
  focusReply: () => void;
  send: () => void;
};

/**
 * Høyre panel i trepanels-arbeidsflaten. Viser hele saken uten å forlate
 * køen — samme komponenter som full ticket-rute, bare tettere.
 */
const TicketPeekPanel = forwardRef<
  TicketPeekHandle,
  { ticketId: string | null; onClose: () => void; className?: string }
>(function TicketPeekPanel({ ticketId, onClose, className }, ref) {
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const canWrite = access?.hasOrdreWrite ?? false;

  const { data, isLoading, isError, error, refetch } = useTicket(ticketId ?? undefined);
  const ticket = data?.ticket ?? null;
  const attachments = data?.attachments ?? [];
  const { data: inbound = [] } = useInboundMessages(ticketId ?? undefined);
  const { data: replies = [] } = useTicketReplies(ticketId ?? undefined);
  const { data: comments = [] } = useInternalComments(ticketId ?? undefined);
  const { data: events = [] } = useTicketEvents(ticketId ?? undefined);
  const { data: customerCard } = useCustomerCard(ticket?.sender_email);
  const { data: linked } = useLinkedOrder(ticket?.related_order_id ?? null);
  const { data: names = {} } = useUserNames(events.map((e) => e.actor_user_id));

  const composerRef = useRef<TicketComposerHandle>(null);
  const [createCustomer, setCreateCustomer] = useState(false);
  const [linkCustomer, setLinkCustomer] = useState(false);

  useImperativeHandle(ref, () => ({
    focusReply: () => composerRef.current?.focus("reply"),
    send: () => composerRef.current?.submit(),
  }));

  const ai = normalizeAiSuggestion(ticket?.ai_suggestion);

  if (!ticketId) {
    return (
      <aside
        className={className}
        aria-label="Forhåndsvisning av henvendelse"
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">Velg en henvendelse</p>
          <p className="text-caption text-muted-foreground">
            Saken åpnes her uten at du mister kø, søk eller posisjon i listen.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={className} aria-label="Forhåndsvisning av henvendelse">
      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        scope="ordre:innboks:peek"
        onRetry={() => void refetch()}
        errorTitle="Kunne ikke hente henvendelsen"
        isEmpty={!isLoading && !ticket}
        emptyTitle="Henvendelsen finnes ikke"
        emptyDescription="Den kan ha blitt slettet."
        skeletonRows={5}
      >
        {ticket && (
          <div className="flex h-full min-h-0 flex-col">
            <header className="flex items-start gap-2 border-b border-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <h2 className="font-display truncate text-base font-semibold text-foreground">
                  {ticket.subject || "(uten emne)"}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusPill
                    label={TICKET_STATUS_LABEL[ticket.status]}
                    tokenVar="--state-info"
                    size="sm"
                  />
                </div>
              </div>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to={`/ordre/ticket/${ticket.id}`}>
                  Åpne full sak <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Lukk forhåndsvisning"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <TicketIdentityCard
                customer={customerCard?.customer}
                orderCount={customerCard?.orderCount ?? 0}
                senderName={ticket.sender_name}
                senderEmail={ticket.sender_email}
                canWrite={canWrite}
                onCreateCustomer={() => setCreateCustomer(true)}
                onLinkCustomer={() => setLinkCustomer(true)}
              />

              <OrderLinkCard
                ticket={ticket}
                linked={linked}
                ai={ai}
                attachments={attachments}
                canWrite={canWrite}
              />

              <AiFieldSuggestions ai={ai} />

              <TicketActionBar
                ticket={ticket}
                canWrite={canWrite}
                linkedOrderNumber={linked?.order?.order_number ?? null}
              />

              <TicketThread
                ticket={ticket}
                attachments={attachments}
                inboundMessages={inbound}
                replies={replies}
                comments={comments}
                events={events}
                names={names}
                linkedOrder={linked?.order ?? null}
                compact
              />
            </div>

            <div className="border-t border-border p-3">
              <TicketComposer ref={composerRef} ticket={ticket} canWrite={canWrite} />
            </div>

            {createCustomer && (
              <QuickCreateCustomerDialog
                open={createCustomer}
                onOpenChange={setCreateCustomer}
                defaultName={ticket.sender_name ?? ""}
                defaultEmail={ticket.sender_email}
                onCreated={() => setCreateCustomer(false)}
              />
            )}
            {linkCustomer && (
              <LinkCustomerDialog
                open={linkCustomer}
                onOpenChange={setLinkCustomer}
                ticket={ticket}
              />
            )}
          </div>
        )}
      </QueryState>
    </aside>
  );
});

export default TicketPeekPanel;
