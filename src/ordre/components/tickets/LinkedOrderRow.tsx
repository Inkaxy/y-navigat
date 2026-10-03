import { Link } from "react-router-dom";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { getStatusMeta } from "@/ordre/lib/orderStatus";
import { formatDateLong } from "@/ordre/lib/format";
import { orderHref } from "@/ordre/lib/ticketReturn";

/** Én koblet ordre: nummer, ordrestatus, levering og relasjon til saken. */
export default function LinkedOrderRow({
  order,
  primary,
  customerName,
  deliveryTime,
  returnFrom,
  showActions = true,
}: {
  order: { id: string; order_number: string; status: string; delivery_date: string | null };
  primary: boolean;
  customerName?: string | null;
  deliveryTime?: string | null;
  returnFrom: string;
  showActions?: boolean;
}) {
  const meta = getStatusMeta(order.status);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={orderHref(order.id, returnFrom)}
          className="text-sm font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ordre #{order.order_number}
        </Link>
        <StatusPill label={`Ordre: ${meta.label}`} tokenVar={meta.tokenVar} size="sm" />
        <span className="rounded border border-border bg-background px-1.5 text-caption text-muted-foreground">
          {primary ? "Primær kobling" : "Også koblet"}
        </span>
      </div>
      <div className="text-caption text-muted-foreground">
        {customerName ? `${customerName} · ` : ""}
        {order.delivery_date
          ? `Levering ${formatDateLong(order.delivery_date)}${deliveryTime ? ` kl. ${deliveryTime.slice(0, 5)}` : ""}`
          : "Ingen leveringsdato"}
      </div>
      {showActions && (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1">
            <Link to={orderHref(order.id, returnFrom)}>
              Åpne ordre <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to={orderHref(order.id, returnFrom, { tab: "samtaler" })}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Se samtaler
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
