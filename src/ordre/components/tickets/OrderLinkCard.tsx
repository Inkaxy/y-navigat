import { useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryErrorState } from "@/components/common/QueryState";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { TICKET_STATUS_LABEL } from "@/ordre/lib/ticketFormat";
import { TEAM_LABEL } from "@/ordre/lib/teams";
import { isTerminalTicket } from "@/ordre/lib/ticketRowState";
import { currentLocationHref } from "@/ordre/lib/ticketReturn";
import {
  linkTicketToOrder,
  unlinkTicketFromOrder,
  useInvalidateTicketLinks,
} from "@/ordre/hooks/useTicketOrderLink";
import { collectLinkedOrders, useTicketOrderLinks } from "@/ordre/hooks/useTicketDetailData";
import { useUserNames } from "@/ordre/hooks/useUserNames";
import { userErrorMessage } from "@/lib/userError";
import LinkOrderSearch from "@/ordre/components/tickets/LinkOrderSearch";
import CreateOrderFromTicketButton from "@/ordre/components/tickets/CreateOrderFromTicketButton";
import EditLinkedOrderButton from "@/ordre/components/tickets/EditLinkedOrderButton";
import LinkedOrderRow from "@/ordre/components/tickets/LinkedOrderRow";
import OrderLinkMenu from "@/ordre/components/tickets/OrderLinkMenu";
import OrderLinkCandidates from "@/ordre/components/tickets/OrderLinkCandidates";
import type { Ticket, TicketAttachment } from "@/ordre/hooks/useTickets";
import type { AiSuggestion } from "@/ordre/lib/aiSuggestion";

export interface LinkedOrderData {
  order: {
    id: string;
    order_number: string;
    status: string;
    delivery_date: string | null;
    delivery_time: string | null;
    customer_id: string | null;
    subtotal_excl_vat: number | null;
    total_incl_vat?: number | null;
  } | null;
  lines: Array<{
    quantity: number;
    product_snapshot: { name?: string } | null;
    notes: string | null;
  }>;
  customerName?: string | null;
}

export interface LinkedOrderState {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * «Henvendelse og ordre» — samme kompakte oversikt i full sak og peek.
 * Sakens behandling og ordrens oppfyllelse vises hver for seg.
 */
export default function OrderLinkCard({
  ticket,
  linked,
  linkedState,
  ai,
  attachments = [],
  canWrite,
  children,
}: {
  ticket: Ticket;
  linked: LinkedOrderData | undefined;
  linkedState?: LinkedOrderState;
  ai: AiSuggestion | null;
  attachments?: TicketAttachment[];
  canWrite: boolean;
  /** Ekstra innhold (f.eks. ChangeIntentCard) under ordredetaljene. */
  children?: React.ReactNode;
}) {
  const location = useLocation();
  const returnFrom = currentLocationHref(location);
  const invalidateLinks = useInvalidateTicketLinks();
  const invalidate = () => invalidateLinks(ticket.id);
  const [mode, setMode] = useState<"idle" | "search">("idle");
  const linksQuery = useTicketOrderLinks(ticket.id);
  const { data: names = {} } = useUserNames([ticket.assigned_to]);

  const primaryId = ticket.related_order_id;
  const primary = linked?.order ?? null;
  const primaryPending = !!primaryId && (linkedState?.isLoading ?? !linked);
  const primaryError = !!primaryId && !!linkedState?.isError;
  const linksPending = linksQuery.isLoading;
  const orders = collectLinkedOrders(primaryId, primary, linksQuery.data ?? []);
  const anyPending = primaryPending || linksPending;
  const anyError = primaryError || linksQuery.isError;
  const knownNone = !anyPending && !anyError && orders.length === 0 && !primaryId;

  const onUnlink = async () => {
    if (!primary) return;
    try {
      await unlinkTicketFromOrder(ticket.id, primary.id, primary.order_number);
      invalidate();
      toast.success("Koblingen er fjernet. Ordren er beholdt.");
    } catch (e) {
      toast.error(userErrorMessage(e, "Kunne ikke fjerne koblingen"));
    }
  };

  const linkCandidate = async (orderId: string, orderNumber: string | null) => {
    try {
      await linkTicketToOrder(ticket.id, orderId, orderNumber);
      invalidate();
      toast.success("Ordren er koblet til saken");
    } catch (e) {
      toast.error(userErrorMessage(e, "Kunne ikke koble ordren"));
    }
  };

  const assignee = ticket.assigned_to ? (names[ticket.assigned_to] ?? "Ukjent bruker") : null;
  const waiting = ticket.awaiting_internal
    ? `Venter på ${ticket.assigned_team ? TEAM_LABEL[ticket.assigned_team] : "intern avklaring"}`
    : ticket.awaiting_external
      ? "Venter på ekstern part"
      : null;

  return (
    <section
      aria-label="Henvendelse og ordre"
      className="space-y-3 rounded-[10px] border border-border bg-card p-3 shadow-xs"
    >
      <div className="flex items-center gap-2">
        <Link2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-caption font-semibold uppercase tracking-widest text-muted-foreground">
          Henvendelse og ordre
        </h3>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Sak</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          <StatusPill
            label={TICKET_STATUS_LABEL[ticket.status]}
            tokenVar={isTerminalTicket(ticket.status) ? "--state-neutral" : "--state-info"}
            size="sm"
          />
          {waiting && <span className="text-caption text-muted-foreground">{waiting}</span>}
        </dd>
        <dt className="text-muted-foreground">Ansvarlig</dt>
        <dd className="text-foreground">{assignee ?? "Ingen ansvarlig"}</dd>
      </dl>

      <div className="space-y-3 border-t border-border pt-3">
        {anyError && (
          <QueryErrorState
            error={linkedState?.error ?? linksQuery.error}
            scope="ordre:sak:ordrekobling"
            title="Kunne ikke hente ordrekoblingen"
            description="Koblingen kan finnes selv om den ikke vises nå."
            onRetry={() => {
              void linkedState?.refetch();
              void linksQuery.refetch();
            }}
            compact
          />
        )}

        {anyPending && orders.length === 0 && (
          <p className="flex items-center gap-2 text-caption text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Henter ordrekobling …
          </p>
        )}

        {orders.map((o) => (
          <div key={o.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <LinkedOrderRow
                order={o}
                primary={o.primary}
                customerName={o.primary ? linked?.customerName : null}
                deliveryTime={o.primary ? primary?.delivery_time : null}
                returnFrom={returnFrom}
              />
            </div>
            {o.primary && primary && (
              <OrderLinkMenu
                orderNumber={primary.order_number}
                canWrite={canWrite}
                onSwitch={() => setMode("search")}
                onUnlink={onUnlink}
              />
            )}
          </div>
        ))}

        {orders.length > 0 && (
          <p className="text-caption text-muted-foreground">
            Sakens status og ordrens status følges hver for seg. En løst sak betyr ikke at
            ordren er levert.
          </p>
        )}

        {primary && canWrite && (
          <EditLinkedOrderButton
            orderId={primary.id}
            customerId={primary.customer_id ?? null}
            onSaved={invalidate}
          />
        )}

        {knownNone && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Ingen ordre koblet</p>
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  aria-expanded={mode === "search"}
                  data-order-link-trigger
                  onClick={() => setMode((m) => (m === "search" ? "idle" : "search"))}
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Koble eksisterende ordre
                </Button>
                <CreateOrderFromTicketButton
                  ticket={ticket}
                  ai={ai}
                  attachments={attachments}
                  onCreated={invalidate}
                  label="Opprett ny ordre"
                />
              </div>
            )}
          </div>
        )}

        {mode === "search" && canWrite && (
          <div className="space-y-1 border-t border-border pt-2">
            <div className="flex items-center justify-between">
              <span className="text-caption font-semibold text-muted-foreground">
                {primary ? "Velg ordren saken skal kobles til" : "Søk etter ordre"}
              </span>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setMode("idle")}>
                Avbryt
              </Button>
            </div>
            <LinkOrderSearch
              ticketId={ticket.id}
              onLinked={() => {
                setMode("idle");
                invalidate();
              }}
            />
          </div>
        )}

        {knownNone && (
          <OrderLinkCandidates
            ai={ai}
            excludeIds={orders.map((o) => o.id)}
            canWrite={canWrite}
            onLink={(id, num) => void linkCandidate(id, num)}
          />
        )}

        {primary && children}
      </div>
    </section>
  );
}

