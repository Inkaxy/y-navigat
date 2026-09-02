import { Check, Package, Truck, ShoppingCart, Pause, X, FileEdit, Receipt, AlertCircle, ArrowRight, Route } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getStatusMeta } from "@/ordre/lib/orderStatus";
import { formatDateTime, formatRelative, initialsOf } from "@/ordre/lib/format";
import type { OrderEvent } from "@/ordre/hooks/useOrderDetail";

function eventIcon(toStatus: string) {
  const map: Record<string, React.ReactNode> = {
    awaiting_confirmation: <AlertCircle className="h-4 w-4" />,
    confirmed: <Check className="h-4 w-4" />,
    delivered: <Truck className="h-4 w-4" />,
    invoiced: <Receipt className="h-4 w-4" />,
    cancelled: <X className="h-4 w-4" />,
  };
  return map[toStatus] ?? <ShoppingCart className="h-4 w-4" />;
}


function formatTourLabel(t: { tour_number?: number; display_name?: string } | null | undefined) {
  if (!t) return "ingen tur";
  return `Tur ${t.tour_number} — ${t.display_name}`;
}

function eventTitle(ev: OrderEvent) {
  const meta = (ev.metadata ?? {}) as Record<string, unknown>;
  const eventType = meta.event_type as string | undefined;

  if (eventType === "tour_changed") {
    const oldTour = meta.old_tour as { tour_number?: number; display_name?: string } | null;
    const newTour = meta.new_tour as { tour_number?: number; display_name?: string } | null;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        Tur endret fra <span className="font-medium">{formatTourLabel(oldTour)}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">{formatTourLabel(newTour)}</span>
      </span>
    );
  }

  const toLabel = getStatusMeta(ev.to_status).label;
  if (!ev.from_status) return `Ordre opprettet (${toLabel})`;
  const fromLabel = getStatusMeta(ev.from_status).label;
  return (
    <span className="inline-flex items-center gap-1.5">
      Status endret fra <span className="font-medium">{fromLabel}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span className="font-medium">{toLabel}</span>
    </span>
  );
}

export function OrderTimeline({
  events,
  userNames,
}: {
  events: OrderEvent[];
  userNames: Record<string, string>;
}) {
  if (!events.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        Ingen hendelser ennå.
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 border-l-2 border-border pl-6">
      {events.map((ev) => {
        const meta = getStatusMeta(ev.to_status);
        const evMeta = (ev.metadata ?? {}) as Record<string, unknown>;
        const isTourChange = evMeta.event_type === "tour_changed";
        const userName = ev.changed_by ? userNames[ev.changed_by] ?? "Ukjent bruker" : "System";
        const bgColor = isTourChange
          ? "hsl(var(--muted-foreground))"
          : `hsl(var(${meta.tokenVar}))`;
        return (
          <li key={ev.id} className="relative">
            <span
              className="absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full border-2 border-background"
              style={{
                backgroundColor: bgColor,
                color: "hsl(var(--primary-foreground))",
              }}
            >
              {isTourChange ? <Route className="h-4 w-4" /> : eventIcon(ev.to_status)}
            </span>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm">{eventTitle(ev)}</div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default text-xs text-muted-foreground">
                      {formatRelative(ev.changed_at)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{formatDateTime(ev.changed_at)}</TooltipContent>
                </Tooltip>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Avatar className="h-5 w-5">
                  <AvatarFallback className="text-[10px]">{initialsOf(userName)}</AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground">{userName}</span>
              </div>
              {ev.notes && (
                <div className="mt-2 rounded border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-sm">
                  {ev.notes}
                </div>
              )}
              {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Vis detaljer
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(ev.metadata, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
