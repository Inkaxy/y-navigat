// Tidslinje-visning for ticket eller ordre. Skiller visuelt mellom kunde/ansatt/AI/system.
import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import {
  Bot, Building2, History, Link2, Loader2, Mail, MailCheck, Pencil,
  Settings, ShoppingCart, User, UserCog,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useTicketTimeline, type TimelineItem } from "@/ordre/hooks/useTicketTimeline";
import { cn } from "@/lib/utils";

const ACTOR_STYLE: Record<TimelineItem["actor_type"], string> = {
  customer: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  staff:    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  ai:       "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  system:   "bg-muted text-muted-foreground border-border",
};
const ACTOR_LABEL: Record<TimelineItem["actor_type"], string> = {
  customer: "Kunde",
  staff:    "Ansatt",
  ai:       "AI",
  system:   "System",
};

function eventIcon(t: string) {
  if (t.startsWith("ai.")) return Bot;
  if (t === "ticket.received" || t === "customer.replied") return Mail;
  if (t === "reply.sent") return MailCheck;
  if (t === "confirmation.sent") return MailCheck;
  if (t === "ticket.linked_to_order" || t === "ticket.unlinked_from_order") return Link2;
  if (t === "order.created_from_ticket") return ShoppingCart;
  if (t === "order.fields_changed" || t === "ai.suggestion_edited") return Pencil;
  if (t === "ticket.assigned" || t === "ticket.unassigned") return UserCog;
  if (t === "ticket.status_changed" || t === "ticket.resolved" || t === "ticket.reopened" || t === "order.status_changed") return Settings;
  if (t === "order.cancelled") return Building2;
  return History;
}

function actorIcon(a: TimelineItem["actor_type"]) {
  if (a === "ai") return Bot;
  if (a === "customer") return User;
  if (a === "staff") return UserCog;
  return Settings;
}

export type TimelineCardProps = {
  ticketId?: string | null;
  orderId?: string | null;
  title?: string;
  className?: string;
  maxHeight?: number;
};

export function TimelineCard({
  ticketId, orderId,
  title = "Tidslinje",
  className,
  maxHeight = 480,
}: TimelineCardProps) {
  const { data: items = [], isLoading } = useTicketTimeline({ ticketId, orderId });

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          {title}
          {!isLoading && items.length > 0 && (
            <Badge variant="outline" className="ml-auto text-[10px]">{items.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Ingen hendelser logget ennå.
          </p>
        ) : (
          <ScrollArea style={{ maxHeight }} className="pr-3">
            <ol className="relative border-l border-border ml-3 space-y-3">
              {items.map((it) => {
                const Icon = eventIcon(it.event_type as string);
                const AIcon = actorIcon(it.actor_type);
                return (
                  <li key={it.id} className="ml-4 pl-1">
                    <span
                      className={cn(
                        "absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-background",
                        ACTOR_STYLE[it.actor_type],
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </span>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium leading-tight">{it.label}</div>
                        {it.summary && (
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {it.summary}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className={cn("text-[10px] gap-1", ACTOR_STYLE[it.actor_type])}>
                            <AIcon className="h-2.5 w-2.5" />
                            {ACTOR_LABEL[it.actor_type]}
                            {it.actor_label && (
                              <span className="opacity-70 truncate max-w-[120px]">· {it.actor_label}</span>
                            )}
                          </Badge>
                        </div>
                      </div>
                      <time
                        className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0"
                        title={format(new Date(it.occurred_at), "d. MMM yyyy HH:mm:ss", { locale: nb })}
                      >
                        {formatDistanceToNow(new Date(it.occurred_at), { locale: nb, addSuffix: true })}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default TimelineCard;

// Loader-eksport for konsumenter som vil vise sin egen spinner.
export const TimelineLoader = () => (
  <div className="flex items-center justify-center py-6 text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Laster tidslinje …
  </div>
);
