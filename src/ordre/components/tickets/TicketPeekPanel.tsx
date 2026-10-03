import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ExternalLink, Inbox, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
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
import { currentLocationHref, ticketHref } from "@/ordre/lib/ticketReturn";
import TicketIdentityCard from "@/ordre/components/tickets/TicketIdentityCard";
import OrderLinkCard from "@/ordre/components/tickets/OrderLinkCard";
import AiFieldSuggestions, { buildFieldSuggestions } from "@/ordre/components/tickets/AiFieldSuggestions";
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
  const linkedQuery = useLinkedOrder(ticket?.related_order_id ?? null);
  const linked = linkedQuery.data;
  const location = useLocation();
  const { data: names = {} } = useUserNames(events.map((e) => e.actor_user_id));

  const composerRef = useRef<TicketComposerHandle>(null);
  const [createCustomer, setCreateCustomer] = useState(false);
  const [linkCustomer, setLinkCustomer] = useState(false);

  useImperativeHandle(ref, () => ({
    focusReply: () => composerRef.current?.focus("reply"),
    send: () => composerRef.current?.submit(),
  }));

  const ai = normalizeAiSuggestion(ticket?.ai_suggestion);
  const aiCount = ai ? buildFieldSuggestions(ai).length : 0;

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
            <header className="space-y-1 border-b border-border px-3 py-2.5">
              <div className="flex items-start gap-2">
                <h2 className="font-display min-w-0 flex-1 truncate text-base font-semibold text-foreground">
                  {ticket.subject || "(uten emne)"}
                </h2>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link to={ticketHref(ticket.id, currentLocationHref(location))}>
                    Åpne full sak <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Lukk forhåndsvisning">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <p className="truncate text-caption text-muted-foreground">
                {customerCard?.customer?.display_name ?? ticket.sender_name ?? ticket.sender_email}
              </p>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <OrderLinkCard
                ticket={ticket}
                linked={linked}
                linkedState={linkedQuery}
                ai={ai}
                attachments={attachments}
                canWrite={canWrite}
              />

              <TicketActionBar
                ticket={ticket}
                canWrite={canWrite}
                linkedOrderNumber={linked?.order?.order_number ?? null}
              />

              <details className="group rounded-[10px] border border-border bg-card">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Kunde og forslag fra AI
                  {aiCount > 0 ? ` (${aiCount} forslag)` : ""}
                </summary>
                <div className="space-y-3 border-t border-border p-3">
                  <TicketIdentityCard
                    customer={customerCard?.customer}
                    orderCount={customerCard?.orderCount ?? 0}
                    senderName={ticket.sender_name}
                    senderEmail={ticket.sender_email}
                    canWrite={canWrite}
                    onCreateCustomer={() => setCreateCustomer(true)}
                    onLinkCustomer={() => setLinkCustomer(true)}
                  />
                  <AiFieldSuggestions ai={ai} />
                </div>
              </details>

              <section aria-label="Samtale">
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
              </section>
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
                senderEmail={ticket.sender_email}
                senderName={ticket.sender_name}
                onLinked={() => setLinkCustomer(false)}
              />
            )}
          </div>
        )}
      </QueryState>
    </aside>
  );
});

export default TicketPeekPanel;
