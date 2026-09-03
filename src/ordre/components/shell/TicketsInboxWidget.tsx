import { Link, useNavigate } from "react-router-dom";
import {
  Inbox, Paperclip, ArrowRight, AlertCircle, User as UserIcon,
  Search, X, CheckCircle2, UserCheck, Filter,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  useTickets, useTicketCounts, useUpdateTicket, useOrderNumbersByIds,
  type TicketStatus, type TicketPriority, type Ticket,
} from "@/ordre/hooks/useTickets";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative, initialsOf } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { TicketQuickActions } from "./TicketQuickActions";

type Tab = "open" | "new" | "mine" | "unassigned";

const STATUS_LABEL: Record<TicketStatus, string> = {
  new: "Ny", in_progress: "Pågår", resolved: "Løst", closed: "Lukket", spam: "Spam",
};

const STATUS_TONE: Record<TicketStatus, string> = {
  new: "bg-[hsl(var(--alert-info))]/12 text-[hsl(var(--alert-info))] border-[hsl(var(--alert-info))]/30",
  in_progress: "bg-[hsl(var(--alert-warning))]/12 text-[hsl(var(--alert-warning))] border-[hsl(var(--alert-warning))]/30",
  resolved: "bg-[hsl(var(--alert-success))]/12 text-[hsl(var(--alert-success))] border-[hsl(var(--alert-success))]/30",
  closed: "bg-muted text-muted-foreground border-border",
  spam: "bg-destructive/10 text-destructive border-destructive/30",
};

const PRIO_LABEL: Record<TicketPriority, string> = {
  low: "Lav", normal: "Normal", high: "Høy", urgent: "Haster",
};

const VISIBLE_LIMIT = 8;

/**
 * Innboks-widget for ordrekontorets arbeidsbord.
 *
 * Dette er et sammendrag av `/ordre/ticket` — ikke hele innboksen. Widgeten
 * viser åpne e-poster med hurtighandlinger; full liste ligger på egen side.
 */
export function TicketsInboxWidget() {
  const [tab, setTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");
  const [priorities, setPriorities] = useState<TicketPriority[]>([]);
  const [showAll, setShowAll] = useState(false);
  const { data: counts } = useTicketCounts();
  const { user } = useAuth();
  const { toast } = useToast();
  const update = useUpdateTicket();

  const baseFilter =
    tab === "new"
      ? { status: ["new"] as TicketStatus[] }
      : tab === "mine"
        ? { assigned: "mine" as const, status: ["new", "in_progress"] as TicketStatus[] }
        : tab === "unassigned"
          ? { assigned: "unassigned" as const, status: ["new", "in_progress"] as TicketStatus[] }
          : { status: ["new", "in_progress"] as TicketStatus[] };

  const { data: tickets = [], isLoading } = useTickets({
    ...baseFilter,
    search: search.trim() || undefined,
    priority: priorities.length ? priorities : undefined,
  });

  const visible = useMemo(
    () => (showAll ? tickets : tickets.slice(0, VISIBLE_LIMIT)),
    [tickets, showAll],
  );

  const { data: orderNumbers } = useOrderNumbersByIds(
    visible.map((t) => t.related_order_id),
  );

  const togglePrio = (p: TicketPriority) =>
    setPriorities((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const clearFilters = () => { setSearch(""); setPriorities([]); };
  const hasFilters = search.trim().length > 0 || priorities.length > 0;

  const quickPatch = (t: Ticket, patch: Partial<Ticket>, msg: string) =>
    update.mutate({ id: t.id, patch }, {
      onSuccess: () => toast({ title: msg }),
      onError: (e) => toast({
        title: "Feilet", description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
    });

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "open", label: "Åpne", count: (counts?.newCount ?? 0) + (counts?.inProgressCount ?? 0) },
    { key: "new", label: "Nye", count: counts?.newCount ?? 0 },
    { key: "mine", label: "Mine", count: counts?.mineCount ?? 0 },
    { key: "unassigned", label: "Uten ansvarlig" },
  ];

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk emne, avsender, innhold …"
              className="h-8 pl-7 pr-7 text-caption"
            />
            {search && (
              <button
                type="button"
                aria-label="Tøm søk"
                onClick={() => setSearch("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/ordre/ticket">
              Vis alle
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
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

        {/* Filter-rad: prioritet + clear */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Filter className="h-3 w-3" /> Prioritet
          </span>
          {(Object.keys(PRIO_LABEL) as TicketPriority[]).map((p) => {
            const active = priorities.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePrio(p)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                  active
                    ? "border-primary/50 bg-primary/12 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                {PRIO_LABEL[p]}
              </button>
            );
          })}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Fjern filtre
            </button>
          )}
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
            <p className="text-body text-muted-foreground">
              {hasFilters ? "Ingen tickets matcher filtrene." : "Ingen tickets her"}
            </p>
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Fjern filtre
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-background">
            {visible.map((t) => {
              const isUrgent = t.priority === "urgent" || t.priority === "high";
              const isMine = !!user?.id && t.assigned_to === user.id;
              return (
                <li key={t.id} className="relative">
                  {/* Ekte lenke som dekker hele raden — gir tastatur, midtklikk og «åpne i ny fane». */}
                  <Link
                    to={`/ordre/ticket/${t.id}`}
                    className="absolute inset-0 z-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="sr-only">
                      Åpne e-post: {t.subject ?? "(uten emne)"} fra{" "}
                      {t.sender_name ?? t.sender_email}
                    </span>
                  </Link>
                  <div className="group pointer-events-none flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60">
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
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
                        {isMine ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            <UserIcon className="h-2.5 w-2.5" /> Min
                          </span>
                        ) : t.assigned_to ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <UserIcon className="h-2.5 w-2.5" /> Tildelt
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Uten ansvarlig</span>
                        )}
                        {t.related_order_id && (
                          <Link
                            to={`/ordre/ordrer/${t.related_order_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] font-semibold text-primary hover:underline"
                          >
                            · Ordre #{orderNumbers?.[t.related_order_id] ?? "…"}
                          </Link>
                        )}
                      </div>
                    </div>
                    <div
                      className="ml-2 flex flex-shrink-0 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isMine && user?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[10px] text-muted-foreground hover:text-primary"
                          title="Tildel meg"
                          onClick={(e) => {
                            e.stopPropagation();
                            quickPatch(t, { assigned_to: user.id }, "Tildelt deg");
                          }}
                        >
                          <UserCheck className="mr-1 h-3 w-3" /> Meg
                        </Button>
                      )}
                      {t.status !== "resolved" && t.status !== "closed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[10px] text-muted-foreground hover:text-[hsl(var(--alert-success))]"
                          title="Marker som løst"
                          onClick={(e) => {
                            e.stopPropagation();
                            quickPatch(t, { status: "resolved" }, "Markert som løst");
                          }}
                        >
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Løst
                        </Button>
                      )}
                      <TicketQuickActions ticket={t} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {tickets.length > VISIBLE_LIMIT && !showAll && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-muted-foreground">
              Viser {VISIBLE_LIMIT} av {tickets.length}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                Vis alle ({tickets.length})
              </Button>
              <Link
                to="/ordre/ticket"
                className="inline-flex items-center gap-1 text-caption text-primary hover:underline"
              >
                Åpne fullside
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}
        {showAll && tickets.length > VISIBLE_LIMIT && (
          <div className="text-right">
            <Button size="sm" variant="ghost" onClick={() => setShowAll(false)}>
              Vis færre
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
