import { Link, useNavigate } from "react-router-dom";
import { Inbox, Paperclip, ArrowRight, AlertCircle, User as UserIcon } from "lucide-react";
import { useState } from "react";
import { useTickets, useTicketCounts, type TicketStatus } from "@/ordre/hooks/useTickets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative, initialsOf } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { TicketQuickActions } from "./TicketQuickActions";

type Tab = "open" | "new" | "mine" | "unassigned";

const STATUS_LABEL: Record<TicketStatus, string> = {
  new: "Ny",
  in_progress: "Pågår",
  resolved: "Løst",
  closed: "Lukket",
  spam: "Spam",
};

const STATUS_TONE: Record<TicketStatus, string> = {
  new: "bg-[hsl(var(--alert-info))]/12 text-[hsl(var(--alert-info))] border-[hsl(var(--alert-info))]/30",
  in_progress: "bg-[hsl(var(--alert-warning))]/12 text-[hsl(var(--alert-warning))] border-[hsl(var(--alert-warning))]/30",
  resolved: "bg-[hsl(var(--alert-success))]/12 text-[hsl(var(--alert-success))] border-[hsl(var(--alert-success))]/30",
  closed: "bg-muted text-muted-foreground border-border",
  spam: "bg-destructive/10 text-destructive border-destructive/30",
};

export function TicketsInbox() {
  const [tab, setTab] = useState<Tab>("open");
  const { data: counts } = useTicketCounts();
  const navigate = useNavigate();

  const filter =
    tab === "new"
      ? { status: ["new"] as TicketStatus[] }
      : tab === "mine"
        ? { assigned: "mine" as const, status: ["new", "in_progress"] as TicketStatus[] }
        : tab === "unassigned"
          ? { assigned: "unassigned" as const, status: ["new", "in_progress"] as TicketStatus[] }
          : { status: ["new", "in_progress"] as TicketStatus[] };

  const { data: tickets = [], isLoading } = useTickets(filter);
  const visible = tickets.slice(0, 8);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "open", label: "Åpne", count: (counts?.newCount ?? 0) + (counts?.inProgressCount ?? 0) },
    { key: "new", label: "Nye", count: counts?.newCount ?? 0 },
    { key: "mine", label: "Mine", count: counts?.mineCount ?? 0 },
    { key: "unassigned", label: "Uten ansvarlig" },
  ];

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/12 text-primary">
            <Inbox className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-title">Innboks</CardTitle>
            <p className="text-caption text-muted-foreground">
              E-post og forespørsler til ordrekontoret
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to="/ordre/ticket">
            Vis alle
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-medium transition-colors",
                tab === t.key
                  ? "bg-primary/12 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-semibold leading-tight",
                    tab === t.key ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border py-10 text-center">
            <Inbox className="h-6 w-6 text-muted-foreground" />
            <p className="text-body text-muted-foreground">Ingen tickets her</p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-background">
            {visible.map((t) => {
              const isUrgent = t.priority === "urgent" || t.priority === "high";
              return (
                <li key={t.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/ordre/ticket/${t.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigate(`/ordre/ticket/${t.id}`);
                    }}
                    className="group flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:bg-muted/60"
                  >
                    <span
                      className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-caption font-semibold text-muted-foreground"
                      title={t.sender_name ?? t.sender_email}
                    >
                      {initialsOf(t.sender_name ?? t.sender_email)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-body font-medium text-foreground">
                          {t.sender_name ?? t.sender_email}
                        </span>
                        {t.has_attachments && (
                          <Paperclip className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                        )}
                        <span className="ml-auto whitespace-nowrap text-caption text-muted-foreground">
                          {formatRelative(t.received_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="truncate text-body text-foreground/90">
                          {t.subject ?? "(uten emne)"}
                        </span>
                      </div>
                      {t.body_preview && (
                        <p className="mt-0.5 line-clamp-1 text-caption text-muted-foreground">
                          {t.body_preview}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[t.status])}>
                          {STATUS_LABEL[t.status]}
                        </Badge>
                        {isUrgent && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-destructive/40 bg-destructive/10 text-[10px] text-destructive"
                          >
                            <AlertCircle className="h-2.5 w-2.5" />
                            {t.priority === "urgent" ? "Haster" : "Høy"}
                          </Badge>
                        )}
                        {t.assigned_to ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <UserIcon className="h-2.5 w-2.5" /> Tildelt
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Uten ansvarlig</span>
                        )}
                        {t.related_order_id && (
                          <span className="text-[10px] text-primary">· koblet til ordre</span>
                        )}
                      </div>
                    </div>
                    <div className="ml-2 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <TicketQuickActions ticket={t} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {tickets.length > visible.length && (
          <div className="text-right">
            <Link
              to="/ordre/ticket"
              className="inline-flex items-center gap-1 text-caption text-primary hover:underline"
            >
              +{tickets.length - visible.length} flere
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
