import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { Paperclip, Package, AlertTriangle, Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { QueryState } from "@/components/common/QueryState";
import {
  normalizeAiSuggestion,
  REQUEST_TYPE_LABEL,
  REQUEST_TYPE_BADGE,
  type RequestType,
} from "@/ordre/lib/aiSuggestion";
import { TEAMS, TEAM_LABEL, type TicketTeam } from "@/ordre/lib/teams";
import { useSlaSettings } from "@/ordre/hooks/useSlaSettings";
import {
  useLatestReplyByTicket,
  useLatestInboundByTicket,
  isAwaitingCustomer,
} from "@/ordre/hooks/useTickets";

import { computeDeadline, formatCountdown } from "@/ordre/lib/sla";

type TicketRow = {
  id: string;
  subject: string | null;
  body_preview: string | null;
  sender_name: string | null;
  sender_email: string;
  received_at: string;
  status: "new" | "in_progress" | "resolved" | "closed" | "spam";
  assigned_to: string | null;
  assigned_team: TicketTeam | null;
  awaiting_internal: boolean;
  has_attachments: boolean;
  related_order_id: string | null;
  ai_confidence_score: number | null;
  ai_suggestion: unknown;
  orders?: { order_number: string | null } | null;
};

type QueueKey =
  | "all"
  | `intent:${RequestType}`
  | "mine"
  | "awaiting_customer"
  | "resolved"
  | `team:${TicketTeam}`;

const INTENT_QUEUES: { key: RequestType; label: string; icon: string }[] = [
  { key: "new_order", label: "Nye bestillinger", icon: "🛒" },
  { key: "change", label: "Endringer", icon: "✏️" },
  { key: "cancellation", label: "Avbestillinger", icon: "🚫" },
  { key: "complaint", label: "Klager", icon: "⚠️" },
  { key: "question", label: "Spørsmål", icon: "❓" },
];

function initials(name: string | null, email: string): string {
  const src = (name ?? email).trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function ConfidenceChip({ score }: { score: number | null }) {
  if (score == null) return null;
  const pct = Math.round(score * (score > 1 ? 1 : 100));
  const tone =
    pct >= 90
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
      : pct >= 60
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
        : "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone,
      )}
    >
      AI {pct}%
    </span>
  );
}

function useInboxTickets() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["tickets", "inbox"],
    queryFn: async (): Promise<TicketRow[]> => {
      const { data, error } = await supabase
        .from("tickets")
        .select(
          "id, subject, body_preview, sender_name, sender_email, received_at, status, assigned_to, assigned_team, awaiting_internal, has_attachments, related_order_id, ai_confidence_score, ai_suggestion, orders:related_order_id(order_number)",
        )
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as TicketRow[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("tickets-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets" },
        () => qc.invalidateQueries({ queryKey: ["tickets", "inbox"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  return query;
}

function KpiCard({
  value,
  label,
  tone,
  failed,
}: {
  value: number | string;
  label: string;
  tone?: "default" | "danger" | "warn" | "success";
  /** Datasettet feilet — vis strek i stedet for et misvisende null-tall. */
  failed?: boolean;
}) {
  const valueTone = failed
    ? "text-muted-foreground"
    : tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "success"
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-foreground";
  return (
    <div className="rounded-lg border bg-[hsl(var(--brand-cream))] px-5 py-4 shadow-sm">
      <div className={cn("text-3xl font-semibold tracking-tight", valueTone)}>
        {failed ? "–" : value}
      </div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {failed ? `${label} · ikke tilgjengelig` : label}
      </div>
    </div>
  );
}

function QueueButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon?: string;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
        active
          ? "bg-[hsl(var(--brand-bronze)/0.14)] text-foreground font-semibold"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="flex items-center gap-2 truncate">
        {icon && <span className="text-base leading-none">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
          active
            ? "bg-[hsl(var(--brand-bronze))] text-white"
            : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

export default function TicketsInbox() {
  const { user } = useAuth();
  const {
    data: tickets = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useInboxTickets();
  const [queue, setQueue] = useState<QueueKey>("all");
  const { data: openRefundsCount = 0 } = useQuery({
    queryKey: ["refunds", "open-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("refunds")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "approved"]);
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  const { data: sla } = useSlaSettings();

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);
  const { data: latestReply = new Map<string, string>() } = useLatestReplyByTicket(ticketIds);
  const { data: latestInbound = new Map<string, string>() } = useLatestInboundByTicket(ticketIds);

  type Row = TicketRow & {
    intent: RequestType | null;
    deadline: Date | null;
    overdue: boolean;
    countdown: string | null;
    awaitingCustomer: boolean;
  };

  const rows: Row[] = useMemo(
    () => {
      const now = new Date();
      return tickets.map((t) => {
        const ai = normalizeAiSuggestion(t.ai_suggestion);
        const intent = ai?.request_type ?? null;
        const deadline = sla && intent ? computeDeadline(t.received_at, intent, sla.sla, sla.bh) : null;
        const cd = deadline ? formatCountdown(deadline, now) : null;
        return {
          ...t,
          intent,
          deadline,
          overdue: cd?.overdue ?? false,
          countdown: cd?.text ?? null,
          // «Venter på kunde» = siste utgående er nyere enn siste inngående.
          awaitingCustomer: isAwaitingCustomer({
            receivedAt: t.received_at,
            lastOutgoing: latestReply.get(t.id),
            lastInbound: latestInbound.get(t.id),
          }),
        };
      });
    },
    [tickets, sla, latestReply, latestInbound],
  );


  const isOpen = (t: Row) => t.status === "new" || t.status === "in_progress";

  const counts = useMemo(() => {
    const open = rows.filter(isOpen);
    const c = {
      all: open.length,
      awaiting_customer: rows.filter((r) => r.awaitingCustomer && isOpen(r)).length,
      resolved: rows.filter((r) => r.status === "resolved").length,
      mine: rows.filter((r) => r.assigned_to === user?.id && isOpen(r)).length,
      intent: {} as Record<RequestType, number>,
      team: {} as Record<TicketTeam, number>,
    };
    for (const it of INTENT_QUEUES) {
      c.intent[it.key] = open.filter((r) => r.intent === it.key).length;
    }
    for (const team of TEAMS) {
      c.team[team] = open.filter((r) => r.assigned_team === team).length;
    }
    return c;
  }, [rows, user?.id]);

  const kpis = useMemo(() => {
    const open = rows.filter(isOpen);
    const overFrist = open.filter((r) => r.overdue).length;
    const withoutOrder = open.filter(
      (r) => !r.related_order_id && r.intent !== "question",
    ).length;
    return {
      open: open.length,
      awaitingCustomer: counts.awaiting_customer,
      overFrist,
      withoutOrder,
      toPayout: openRefundsCount,
    };
  }, [rows, counts.awaiting_customer, openRefundsCount]);


  const filtered = useMemo(() => {
    let out: Row[];
    if (queue === "all") out = rows.filter(isOpen);
    else if (queue === "mine")
      out = rows.filter((r) => r.assigned_to === user?.id && isOpen(r));
    else if (queue === "awaiting_customer")
      out = rows.filter((r) => r.awaitingCustomer && isOpen(r));
    else if (queue === "resolved") out = rows.filter((r) => r.status === "resolved");
    else if (queue.startsWith("intent:")) {
      const k = queue.slice("intent:".length) as RequestType;
      out = rows.filter((r) => r.intent === k && isOpen(r));
    } else if (queue.startsWith("team:")) {
      const k = queue.slice("team:".length) as TicketTeam;
      out = rows.filter((r) => r.assigned_team === k && isOpen(r));
    } else out = rows;
    return queue === "resolved" ? out : [...out].sort(sortByDeadline);
  }, [rows, queue, user?.id]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[hsl(var(--brand-cream))] text-xl">
          ✉️
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Ticket · Ordresamtaler
          </h1>
          <p className="text-sm text-muted-foreground">
            E-post til ordrekontoret — koblet til kunder og ordrer
          </p>
        </div>
      </div>

      {/* KPI-rad */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard value={kpis.open} label="Åpne" failed={isError} />
        <KpiCard value={kpis.awaitingCustomer} label="Venter på kunde" failed={isError} />
        <KpiCard value={kpis.overFrist} label="Over frist" tone="danger" failed={isError} />
        <KpiCard value={kpis.withoutOrder} label="Uten ordre-kobling" failed={isError} />
        <KpiCard value={kpis.toPayout} label="Til utbetaling" tone="success" />
      </div>


      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* Køer */}
        <aside className="rounded-lg border bg-[hsl(var(--brand-cream))] p-2">
          <SectionLabel>Køer</SectionLabel>
          <QueueButton
            active={queue === "all"}
            onClick={() => setQueue("all")}
            label="Alle åpne"
            count={counts.all}
          />
          {INTENT_QUEUES.map((q) => (
            <QueueButton
              key={q.key}
              active={queue === `intent:${q.key}`}
              onClick={() => setQueue(`intent:${q.key}`)}
              icon={q.icon}
              label={q.label}
              count={counts.intent[q.key] ?? 0}
            />
          ))}

          <SectionLabel>Mine</SectionLabel>
          <QueueButton
            active={queue === "mine"}
            onClick={() => setQueue("mine")}
            label="Tildelt meg"
            count={counts.mine}
          />
          <QueueButton
            active={queue === "awaiting_customer"}
            onClick={() => setQueue("awaiting_customer")}
            label="Venter på kunde"
            count={counts.awaiting_customer}
          />
          <QueueButton
            active={queue === "resolved"}
            onClick={() => setQueue("resolved")}
            label="Løste"
            count={counts.resolved}
          />

          <SectionLabel>Team-køer</SectionLabel>
          {TEAMS.map((team) => (
            <QueueButton
              key={team}
              active={queue === `team:${team}`}
              onClick={() => setQueue(`team:${team}`)}
              label={TEAM_LABEL[team]}
              count={counts.team[team] ?? 0}
            />
          ))}

          <SectionLabel>Oppgaver</SectionLabel>
          <Link
            to="/ordre/tilbakebetalinger"
            className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <span className="flex items-center gap-2 truncate">
              <span className="text-base leading-none">💸</span>
              <span className="truncate">Tilbakebetalinger</span>
            </span>
          </Link>
        </aside>

        {/* Liste */}
        <QueryState
          isLoading={isLoading}
          isError={isError}
          error={error}
          scope="ordre:innboks"
          onRetry={() => void refetch()}
          errorTitle="Kunne ikke hente e-postene"
          isEmpty={filtered.length === 0}
          emptyTitle="Ingen tickets i denne køen."
          emptyDescription="Velg en annen kø i menyen til venstre."
          emptyIcon={Inbox}
          skeletonRows={6}
          skeletonRowClassName="h-16 rounded-lg"
        >
          <ul className="space-y-2">
            {filtered.map((t) => {
              const unread = t.status === "new";
              const badgeCls = t.intent
                ? REQUEST_TYPE_BADGE[t.intent]
                : "bg-muted text-muted-foreground border-border";
              const badgeLabel = t.intent
                ? REQUEST_TYPE_LABEL[t.intent].toUpperCase()
                : "UKATEGORISERT";
              return (
                <li
                  key={t.id}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg border bg-[hsl(var(--brand-cream))] px-4 py-3 shadow-sm transition-colors hover:bg-[hsl(var(--brand-cream-deep))]",
                    unread && "border-l-4 border-l-orange-500",
                  )}
                >
                  {/* Ekte lenke som dekker hele raden — gir tastatur, midtklikk og «åpne i ny fane». */}
                  <Link
                    to={`/ordre/ticket/${t.id}`}
                    className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--brand-bronze))]"
                  >
                    <span className="sr-only">
                      Åpne e-post: {t.subject || "(uten emne)"} fra{" "}
                      {t.sender_name || t.sender_email}
                    </span>
                  </Link>

                  <div className="pointer-events-none flex w-full items-center gap-3">
                    <div
                      className={cn(
                        "inline-flex shrink-0 items-center rounded border px-2 py-1 text-[10px] font-bold tracking-wide",
                        badgeCls,
                      )}
                    >
                      {badgeLabel}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {t.subject || "(uten emne)"}
                        </span>
                        {t.has_attachments && (
                          <Paperclip
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-label="Har vedlegg"
                          />
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {t.body_preview || t.sender_email}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {t.related_order_id && t.orders?.order_number ? (
                        <Link
                          to={`/ordre/ordrer/${t.related_order_id}`}
                          className="pointer-events-auto relative z-10 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Package className="h-3 w-3" aria-hidden="true" />
                          #{t.orders.order_number}
                        </Link>
                      ) : (
                        <span className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
                          Ingen ordre ennå
                        </span>
                      )}
                      <ConfidenceChip score={t.ai_confidence_score} />
                      {t.countdown && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            t.overdue
                              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                              : "border-border bg-muted text-muted-foreground",
                          )}
                          title={t.deadline ? `Frist: ${t.deadline.toLocaleString("nb-NO")}` : ""}
                        >
                          {t.overdue && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                          {t.countdown}
                        </span>
                      )}
                      <span className="w-24 text-right text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(t.received_at), {
                          locale: nb,
                          addSuffix: true,
                        })}
                      </span>
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                        title={t.assigned_to ? "Tildelt" : "Ikke tildelt"}
                      >
                        {t.assigned_to ? initials(t.sender_name, t.sender_email) : "—"}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </QueryState>

      </div>
    </div>
  );
}
