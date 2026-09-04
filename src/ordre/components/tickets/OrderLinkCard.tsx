import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Link2Off, Package, Replace } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getStatusMeta } from "@/ordre/lib/orderStatus";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { formatNOK, formatDateLong } from "@/ordre/lib/format";
import { linkTicketToOrder, unlinkTicketFromOrder } from "@/ordre/hooks/useTicketOrderLink";
import LinkOrderSearch from "@/ordre/components/tickets/LinkOrderSearch";
import CreateOrderFromTicketButton from "@/ordre/components/tickets/CreateOrderFromTicketButton";
import EditLinkedOrderButton from "@/ordre/components/tickets/EditLinkedOrderButton";
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

/** Alle ordrer koblet via ticket_order_links (i tillegg til related_order_id). */
function useTicketOrderLinks(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ["ticket-order-links", ticketId],
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("ticket_order_links")
        .select("order_id")
        .eq("ticket_id", ticketId!);
      if (error) throw error;
      const ids = (links ?? []).map((l) => l.order_id as string);
      if (!ids.length) return [] as Array<{ id: string; order_number: string; status: string }>;
      const { data: orders } = await supabase
        .from("orders")
        .select("id, order_number, status")
        .in("id", ids);
      return (orders ?? []) as Array<{ id: string; order_number: string; status: string }>;
    },
  });
}

/**
 * «Ordre»-kortet i høyre kolonne. Alltid øverst: hvilken ordre henvendelsen
 * gjelder er det viktigste på siden.
 */
export default function OrderLinkCard({
  ticket,
  linked,
  ai,
  attachments = [],
  canWrite,
  children,
}: {
  ticket: Ticket;
  linked: LinkedOrderData | undefined;
  ai: AiSuggestion | null;
  attachments?: TicketAttachment[];
  canWrite: boolean;
  /** Ekstra innhold (f.eks. ChangeIntentCard) under ordredetaljene. */
  children?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [switching, setSwitching] = useState(false);
  const { data: extraLinks = [] } = useTicketOrderLinks(ticket.id);
  const order = linked?.order ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
    qc.invalidateQueries({ queryKey: ["ticket-events", ticket.id] });
    qc.invalidateQueries({ queryKey: ["ticket-order-links", ticket.id] });
    qc.invalidateQueries({ queryKey: ["cake-images-for", ticket.id] });
  };

  const onUnlink = async () => {
    if (!order) return;
    try {
      await unlinkTicketFromOrder(ticket.id, order.id, order.order_number);
      invalidate();
      toast.success("Ordrekoblingen er fjernet");
    } catch (e) {
      toast.error(`Kunne ikke fjerne kobling: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const linkCandidate = async (orderId: string, orderNumber: string | null) => {
    try {
      await linkTicketToOrder(ticket.id, orderId, orderNumber);
      invalidate();
      toast.success("Ordren er koblet til samtalen");
    } catch (e) {
      toast.error(`Kunne ikke koble: ${e instanceof Error ? e.message : String(e)}`);
    }
  };


  const candidates = (ai?.candidate_orders ?? []).filter(
    (c) => c.order_id && c.order_id !== ticket.related_order_id,
  );

  return (
    <div className="rounded-[10px] border border-border bg-card p-4 shadow-xs">
      <div className="mb-2 flex items-center gap-2">
        <Package className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Ordre
        </div>
      </div>

      {order ? (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/ordre/ordrer/${order.id}`}
              className="font-semibold text-foreground underline-offset-2 hover:underline"
            >
              #{order.order_number}
            </Link>
            <StatusPill
              label={getStatusMeta(order.status).label}
              tokenVar={getStatusMeta(order.status).tokenVar}
              size="sm"
            />
          </div>
          {linked?.customerName && (
            <div className="text-xs text-muted-foreground">{linked.customerName}</div>
          )}
          {order.delivery_date && (
            <div className="text-xs text-muted-foreground">
              Levering {formatDateLong(order.delivery_date)}
              {order.delivery_time ? ` kl. ${order.delivery_time.slice(0, 5)}` : ""}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Sum {formatNOK(order.total_incl_vat ?? order.subtotal_excl_vat)}
          </div>
          {(linked?.lines.length ?? 0) > 0 && (
            <ul className="space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
              {linked!.lines.slice(0, 6).map((l, i) => (
                <li key={i} className="truncate">
                  {l.quantity} × {l.product_snapshot?.name ?? l.notes ?? "linje"}
                </li>
              ))}
            </ul>
          )}

          {extraLinks.length > 1 && (
            <div className="border-t pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Koblede ordrer
              </div>
              <ul className="space-y-0.5 text-xs">
                {extraLinks.map((o) => (
                  <li key={o.id} className="flex items-center gap-1.5">
                    <Link
                      to={`/ordre/ordrer/${o.id}`}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      #{o.order_number}
                    </Link>
                    {o.id === order.id && (
                      <span className="rounded border border-border bg-background px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Primær
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button asChild variant="outline" size="sm" className="gap-1">
              <Link to={`/ordre/ordrer/${order.id}`}>
                Åpne ordre <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setSwitching((v) => !v)}
              disabled={!canWrite}
            >
              <Replace className="h-3.5 w-3.5" /> Bytt ordre
            </Button>
          </div>
          {canWrite && (
            <EditLinkedOrderButton
              orderId={order.id}
              customerId={order.customer_id ?? null}
              onSaved={invalidate}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-1 text-muted-foreground"
            onClick={onUnlink}
            disabled={!canWrite}
          >
            <Link2Off className="h-3.5 w-3.5" /> Fjern kobling
          </Button>

          {switching && canWrite && (
            <div className="border-t pt-2">
              <LinkOrderSearch ticketId={ticket.id} onLinked={() => { setSwitching(false); invalidate(); }} />
            </div>
          )}

          {children}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Ingen ordre er koblet til denne henvendelsen ennå.
          </p>
          {canWrite && <LinkOrderSearch ticketId={ticket.id} onLinked={invalidate} />}

          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                AI-forslag
              </div>
              {candidates.slice(0, 5).map((c) => (
                <button
                  key={c.order_id}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => void linkCandidate(c.order_id, c.order_number)}
                  className={cn(
                    "w-full rounded-md border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-60",
                  )}
                >
                  <div className="font-medium text-foreground">
                    #{c.order_number ?? c.order_id.slice(0, 8)}
                    {c.snapshot?.customer_name ? ` · ${c.snapshot.customer_name}` : ""}
                  </div>
                  <div className="text-muted-foreground">{c.why_match}</div>
                </button>
              ))}
            </div>
          )}

          {canWrite && (
            <div className="border-t pt-2">
              <CreateOrderFromTicketButton
                ticket={ticket}
                ai={ai}
                attachments={attachments}
                onCreated={invalidate}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
