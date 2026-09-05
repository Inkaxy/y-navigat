import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarOff, Link2, ShieldAlert, ShoppingBag, UserPlus, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { osloDateISO, osloTodayISO } from "@/lib/osloDate";
import { getStatusMeta } from "@/ordre/lib/orderStatus";
import { useRecentOrdersForCustomer } from "@/ordre/hooks/useRecentOrdersForCustomer";
import { useDeliveryPausesForCustomer } from "@/ordre/hooks/useDeliveryPausesForCustomer";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { ticketInitials } from "@/ordre/lib/ticketFormat";
import type { TicketCustomer } from "@/ordre/hooks/useTicketDetailData";

/**
 * Hvem er dette? Alltid det første saksbehandleren ser.
 * Ukjent avsender får en tydelig markering og to konkrete veier videre.
 */
export default function TicketIdentityCard({
  customer,
  orderCount,
  senderName,
  senderEmail,
  canWrite,
  onCreateCustomer,
  onLinkCustomer,
  className,
}: {
  customer: TicketCustomer | null | undefined;
  orderCount: number;
  senderName: string | null;
  senderEmail: string;
  canWrite: boolean;
  onCreateCustomer: () => void;
  onLinkCustomer: () => void;
  className?: string;
}) {
  const known = !!customer;

  return (
    <section
      aria-label="Kundeidentitet"
      className={cn("rounded-[10px] border border-border bg-card p-3 shadow-xs", className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
            known ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {known ? ticketInitials(customer!.display_name) : <UserRound className="h-4 w-4" />}
        </span>

        <div className="min-w-0 flex-1">
          {known ? (
            <>
              <Link
                to={`/kunder/kundeliste/${customer!.id}`}
                className="font-display block truncate text-base font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {customer!.display_name}
              </Link>
              <div className="truncate text-caption text-muted-foreground">
                Kundenr. {customer!.customer_number} · {senderEmail}
              </div>
              {customer!.primary_contact_phone && (
                <div className="truncate text-caption text-muted-foreground">
                  {customer!.primary_contact_phone}
                </div>
              )}
              <div className="mt-1.5 inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                <ShoppingBag className="h-3 w-3" aria-hidden="true" />
                {orderCount} ordrer siste 12 måneder
              </div>
              <CustomerQuickContext customerId={customer!.id} />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display truncate text-base font-semibold text-foreground">
                  {senderName || senderEmail}
                </span>
                <StatusPill label="Ukjent avsender" tokenVar="--state-warning" />
              </div>
              <div className="truncate text-caption text-muted-foreground">{senderEmail}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCreateCustomer}
                  disabled={!canWrite}
                  className="gap-1.5"
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Opprett kunde
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onLinkCustomer}
                  disabled={!canWrite}
                  className="gap-1.5"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Koble til eksisterende
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Kompakt kundekontekst: siste tre ordrer, aktiv leveransepause og kredittstopp.
 * Saksbehandleren skal slippe å åpne kundekortet for å svare.
 */
function CustomerQuickContext({ customerId }: { customerId: string }) {
  const today = osloTodayISO();
  const horizon = osloDateISO(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  const { data: orders = [] } = useRecentOrdersForCustomer(customerId, true);
  const { data: pauses } = useDeliveryPausesForCustomer(customerId, today, horizon);
  const { data: flags } = useQuery({
    queryKey: ["ticket-customer-flags", customerId],
    staleTime: 60_000,
    queryFn: async (): Promise<{ credit_hold: boolean; credit_hold_reason: string | null }> => {
      const { data, error } = await supabase
        .from("customers")
        .select("credit_hold, credit_hold_reason")
        .eq("id", customerId)
        .maybeSingle();
      if (error) throw error;
      return {
        credit_hold: !!data?.credit_hold,
        credit_hold_reason: data?.credit_hold_reason ?? null,
      };
    },
  });

  const pause = pauses && pauses.size > 0 ? [...pauses.entries()][0] : null;
  const latest = orders.slice(0, 3);

  return (
    <div className="mt-2 space-y-1.5">
      {flags?.credit_hold && (
        <div className="flex items-start gap-1.5 text-caption text-[hsl(var(--state-danger))]">
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            Kredittstopp{flags.credit_hold_reason ? ` — ${flags.credit_hold_reason}` : ""}
          </span>
        </div>
      )}
      {pause && (
        <div className="flex items-start gap-1.5 text-caption text-[hsl(var(--state-warning))]">
          <CalendarOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            Leveransepause {pause[0].split("|")[0]}
            {pause[1].reason ? ` — ${pause[1].reason}` : ""}
          </span>
        </div>
      )}
      {latest.length > 0 && (
        <ul className="space-y-0.5">
          {latest.map((o) => (
            <li key={o.id} className="truncate text-caption text-muted-foreground">
              <Link
                to={`/ordre/ordrer/${o.id}`}
                className="text-foreground underline-offset-2 hover:underline"
              >
                #{o.order_number}
              </Link>{" "}
              · {o.delivery_date} · {getStatusMeta(o.status).label}
            </li>
          ))}
        </ul>
      )}
      <Link
        to={`/kunder/kundeliste/${customerId}`}
        className="inline-block text-caption text-primary underline-offset-2 hover:underline"
      >
        Åpne kundekort
      </Link>
    </div>
  );
}
