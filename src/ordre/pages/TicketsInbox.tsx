import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { QueryErrorState, QueryState } from "@/components/common/QueryState";
import { PageHeader } from "@/ordre/components/shell/PageHeader";
import { normalizeAiSuggestion, REQUEST_TYPE_LABEL, type RequestType } from "@/ordre/lib/aiSuggestion";
import { TEAMS, TEAM_LABEL, type TicketTeam } from "@/ordre/lib/teams";
import { useSlaBreachNotifications } from "@/ordre/hooks/useSlaBreachNotifications";
import { useSlaSettings } from "@/ordre/hooks/useSlaSettings";
import {
  useLatestReplyByTicket,
  useLatestInboundByTicket,
  isAwaitingCustomer,
} from "@/ordre/hooks/useTickets";
import { computeDeadline, formatCountdown } from "@/ordre/lib/sla";
import { useUserNames } from "@/ordre/hooks/useUserNames";
import { useUserAccess } from "@/ordre/hooks/useUserAccess";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL } from "@/ordre/lib/ticketFormat";
import type { TicketPriority } from "@/ordre/hooks/useTickets";
import {
  countQueues,
  isArchiveQueue,
  matchesQueue,
  parseQueueParam,
  PRIMARY_QUEUES,
  type QueueKey,
} from "@/ordre/lib/ticketQueues";
import { BULK_LABEL, runBulkAction, type BulkAction } from "@/ordre/lib/ticketBulk";
import { useTicketShortcuts } from "@/ordre/hooks/useTicketShortcuts";
import TicketListRow, { type InboxRow } from "@/ordre/components/tickets/TicketListRow";
import TicketPeekPanel, {
  type TicketPeekHandle,
} from "@/ordre/components/tickets/TicketPeekPanel";
import ShortcutHelp from "@/ordre/components/tickets/ShortcutHelp";

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
  priority: TicketPriority;
  updated_at: string;
  awaiting_internal: boolean;
  has_attachments: boolean;
  related_order_id: string | null;
  ai_confidence_score: number | null;
  ai_suggestion: unknown;
  orders?: { order_number: string | null } | null;
};

const INTENT_QUEUES: { key: RequestType; label: string }[] = [
  { key: "new_order", label: REQUEST_TYPE_LABEL.new_order },
  { key: "change", label: REQUEST_TYPE_LABEL.change },
  { key: "cancellation", label: REQUEST_TYPE_LABEL.cancellation },
  { key: "complaint", label: REQUEST_TYPE_LABEL.complaint },
  { key: "question", label: REQUEST_TYPE_LABEL.question },
];

const TICKET_SELECT =
  "id, subject, body_preview, sender_name, sender_email, received_at, updated_at, status, priority, assigned_to, assigned_team, awaiting_internal, has_attachments, related_order_id, ai_confidence_score, ai_suggestion, orders:related_order_id(order_number)";

/** Antall lukkede/søppel-saker vi laster ned — resten telles med head-count. */
const ARCHIVE_PAGE = 200;

function useInboxTickets() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["tickets", "inbox"],
    queryFn: async (): Promise<TicketRow[]> => {
      // Åpne saker hentes KOMPLETT (paginert) slik at køtellerne aldri lyver.
      const open = await fetchAllRows<TicketRow>((from, to) =>
        supabase
          .from("tickets")
          .select(TICKET_SELECT)
          .not("status", "in", "(closed,spam)")
          .order("received_at", { ascending: false })
          .range(from, to) as never,
      );
      // Arkivet er ubegrenset stort — vis kun de nyeste, tell resten separat.
      const { data: archive, error } = await supabase
        .from("tickets")
        .select(TICKET_SELECT)
        .in("status", ["closed", "spam"])
        .order("received_at", { ascending: false })
        .limit(ARCHIVE_PAGE);
      if (error) throw error;
      return [...open, ...((archive ?? []) as unknown as TicketRow[])];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("tickets-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => {
        qc.invalidateQueries({ queryKey: ["tickets", "inbox"] });
        qc.invalidateQueries({ queryKey: ["tickets", "archive-counts"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  return query;
}

/** Desktop = tre paneler. Mindre skjermer går liste → full ticket-rute. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

function QueueButton({
  active,
  onClick,
  label,
  description,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description?: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 font-semibold text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm">{label}</span>
        {description && (
          <span className="block truncate text-caption text-muted-foreground">{description}</span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-4 px-3 text-caption font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

/** Over frist først, deretter tidligste frist, til slutt eldste e-post. */
function sortByDeadline(a: InboxRow, b: InboxRow) {
  if (a.overdue && !b.overdue) return -1;
  if (!a.overdue && b.overdue) return 1;
  const ad = a.deadline?.getTime() ?? Infinity;
  const bd = b.deadline?.getTime() ?? Infinity;
  if (ad !== bd) return ad - bd;
  return new Date(a.received_at).getTime() - new Date(b.received_at).getTime();
}

export default function TicketsInbox() {
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const canWrite = access?.hasOrdreWrite ?? false;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isDesktop = useIsDesktop();
  const { data: tickets = [], isLoading, isError, error, refetch } = useInboxTickets();

  // Kø, søk og valgt sak ligger i URL-en slik at kontekst overlever refresh,
  // deling av lenke og tilbake-navigasjon fra full ticket-rute.
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = parseQueueParam(searchParams.get("queue"), {
    intents: INTENT_QUEUES.map((q) => q.key),
    teams: TEAMS,
  });
  const selectedId = searchParams.get("t");
  const search = searchParams.get("q") ?? "";
  const priority = (searchParams.get("prio") as TicketPriority | null) ?? "all";

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") params.delete(k);
        else params.set(k, v);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setQueue = (next: QueueKey) => patchParams({ queue: next, t: null });

  const { data: sla } = useSlaSettings();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const peekRef = useRef<TicketPeekHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const {
    data: openRefundsCount = 0,
    isError: isRefundsError,
    error: refundsQueryError,
    refetch: refetchRefunds,
  } = useQuery({
    queryKey: ["refunds", "open-count"],
    queryFn: async () => {
      const { count, error: refundsError } = await supabase
        .from("refunds")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "approved"]);
      if (refundsError) throw refundsError;
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);
  const { data: latestReply = new Map<string, string>() } = useLatestReplyByTicket(ticketIds);
  const { data: latestInbound = new Map<string, string>() } = useLatestInboundByTicket(ticketIds);
  const assigneeIds = useMemo(() => tickets.map((t) => t.assigned_to), [tickets]);
  const { data: assigneeNames = {} } = useUserNames(assigneeIds);

  const rows: (InboxRow & { assigned_team: TicketTeam | null; awaiting_internal: boolean })[] =
    useMemo(() => {
      const now = new Date();
      return tickets.map((t) => {
        const ai = normalizeAiSuggestion(t.ai_suggestion);
        const intent = ai?.request_type ?? null;
        const deadline = sla
          ? computeDeadline(t.received_at, intent, sla.sla, sla.bh)
          : null;
        const cd = deadline ? formatCountdown(deadline, now) : null;
        return {
          ...t,
          intent,
          deadline,
          overdue: cd?.overdue ?? false,
          countdown: cd?.text ?? null,
          awaitingCustomer: isAwaitingCustomer({
            receivedAt: t.received_at,
            lastOutgoing: latestReply.get(t.id),
            lastInbound: latestInbound.get(t.id),
          }),
        };
      });
    }, [tickets, sla, latestReply, latestInbound]);

  // Varsle brukeren når egne/åpne saker passerer SLA-fristen.
  useSlaBreachNotifications(rows, user?.id ?? null, selectedId);

  // Lukket/søppel lastes bare delvis ned — hent eksakt antall fra serveren.
  const { data: archiveCounts } = useQuery({
    queryKey: ["tickets", "archive-counts"],
    queryFn: async () => {
      const [closed, spam] = await Promise.all([
        supabase.from("tickets").select("id", { count: "exact", head: true }).eq("status", "closed"),
        supabase.from("tickets").select("id", { count: "exact", head: true }).eq("status", "spam"),
      ]);
      if (closed.error) throw closed.error;
      if (spam.error) throw spam.error;
      return { closed: closed.count ?? 0, spam: spam.count ?? 0 };
    },
  });

  const counts = useMemo(() => {
    const keys: QueueKey[] = [
      ...PRIMARY_QUEUES.map((q) => q.key),
      "new",
      "all_open",
      "resolved",
      "closed",
      "spam",
      ...INTENT_QUEUES.map((q) => `intent:${q.key}` as QueueKey),
      ...TEAMS.map((t) => `team:${t}` as QueueKey),
    ];
    const c = countQueues(rows, user?.id, keys);
    if (archiveCounts) {
      c.closed = archiveCounts.closed;
      c.spam = archiveCounts.spam;
    }
    return c;
  }, [rows, user?.id, archiveCounts]);

  const filtered = useMemo(() => {
    let out = rows.filter((r) => matchesQueue(r, queue, user?.id));
    if (priority !== "all") out = out.filter((r) => r.priority === priority);
    const term = search.trim().toLowerCase();
    if (term.length >= 2) {
      out = out.filter((r) =>
        [r.subject, r.sender_name, r.sender_email, r.body_preview, r.orders?.order_number]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term)),
      );
    }
    return isArchiveQueue(queue)
      ? [...out].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      : [...out].sort(sortByDeadline);
  }, [rows, queue, user?.id, search, priority]);

  const openTicket = useCallback(
    (id: string) => {
      // Desktop: peek i høyre panel (kø, søk og scroll beholdes).
      // Mindre skjermer: full rute, med innboks-URL-en i history for tilbake.
      if (isDesktop) patchParams({ t: id });
      else navigate(`/ordre/ticket/${id}`);
    },
    [isDesktop, navigate, patchParams],
  );

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["tickets", "inbox"] });
  }, [qc]);

  const bulk = useCallback(
    async (action: BulkAction, ids: string[]) => {
      if (!canWrite || ids.length === 0) return;
      const { ok, failed } = await runBulkAction(ids, action, user?.id ?? null);
      invalidate();
      setSelection(new Set());
      if (failed === 0) toast.success(`${BULK_LABEL[action]}: ${ok} sak(er) oppdatert`);
      else toast.error(`${ok} oppdatert, ${failed} feilet`);
    },
    [canWrite, invalidate, user?.id],
  );

  // Tastaturnavigasjon på desktop.
  const move = useCallback(
    (delta: number) => {
      if (filtered.length === 0) return;
      const idx = filtered.findIndex((r) => r.id === selectedId);
      const next = idx < 0 ? 0 : Math.min(filtered.length - 1, Math.max(0, idx + delta));
      const target = filtered[next];
      if (!target) return;
      patchParams({ t: target.id });
      listRef.current
        ?.querySelector(`[data-ticket-row="${target.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    [filtered, patchParams, selectedId],
  );

  useTicketShortcuts(
    {
      onNext: () => move(1),
      onPrev: () => move(-1),
      onReply: () => peekRef.current?.focusReply(),
      onSend: () => peekRef.current?.send(),
      onAssignSelf: () => selectedId && void bulk("assign_me", [selectedId]),
      onResolve: () => selectedId && void bulk("resolve", [selectedId]),
      onLinkOrder: () => {
        const el = document.querySelector<HTMLInputElement>("[data-order-link-search]");
        el?.focus();
      },
      onHelp: () => setHelpOpen(true),
    },
    isDesktop,
  );

  const allSelected = filtered.length > 0 && filtered.every((r) => selection.has(r.id));

  return (
    <div className="mx-auto flex h-[calc(100dvh-var(--shell-offset,7rem))] max-w-[1600px] flex-col px-4 py-4 md:px-6">
      <PageHeader
        eyebrow="Ordre"
        title="Innboks"
        description="Henvendelser til ordrekontoret — kø, kunde og ordre på samme flate"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/ordre/tilbakebetalinger">
                Tilbakebetalinger{openRefundsCount > 0 ? ` (${openRefundsCount})` : ""}
              </Link>
            </Button>
            <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
          </div>
        }
      />

      {isRefundsError && (
        <QueryErrorState
          error={refundsQueryError}
          scope="ordre:innboks:refusjoner"
          onRetry={() => void refetchRefunds()}
          title="Kunne ikke hente tilbakebetalinger"
          description="Resten av innboksen er oppdatert."
          compact
          className="mb-3"
        />
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[240px_minmax(340px,1fr)] xl:grid-cols-[240px_minmax(360px,0.9fr)_minmax(420px,1.1fr)]">
        {/* Venstre: arbeidskøer */}
        <nav
          aria-label="Arbeidskøer"
          className="min-h-0 overflow-y-auto rounded-[10px] border border-border bg-card p-2"
        >
          <SectionLabel>Arbeidskøer</SectionLabel>
          {PRIMARY_QUEUES.map((q) => (
            <QueueButton
              key={q.key}
              active={queue === q.key}
              onClick={() => setQueue(q.key)}
              label={q.label}
              description={q.description}
              count={counts[q.key] ?? 0}
            />
          ))}

          <SectionLabel>Alle saker</SectionLabel>
          <QueueButton
            active={queue === "new"}
            onClick={() => setQueue("new")}
            label="Nye"
            count={counts.new ?? 0}
          />
          <QueueButton
            active={queue === "all_open"}
            onClick={() => setQueue("all_open")}
            label="Alle åpne"
            count={counts.all_open ?? 0}
          />
          <QueueButton
            active={queue === "resolved"}
            onClick={() => setQueue("resolved")}
            label="Løste"
            count={counts.resolved ?? 0}
          />
          <QueueButton
            active={queue === "closed"}
            onClick={() => setQueue("closed")}
            label="Lukket"
            count={counts.closed ?? 0}
          />
          <QueueButton
            active={queue === "spam"}
            onClick={() => setQueue("spam")}
            label="Søppel"
            count={counts.spam ?? 0}
          />

          <SectionLabel>Type henvendelse</SectionLabel>
          {INTENT_QUEUES.map((q) => (
            <QueueButton
              key={q.key}
              active={queue === `intent:${q.key}`}
              onClick={() => setQueue(`intent:${q.key}`)}
              label={q.label}
              count={counts[`intent:${q.key}`] ?? 0}
            />
          ))}

          <SectionLabel>Team</SectionLabel>
          {TEAMS.map((team) => (
            <QueueButton
              key={team}
              active={queue === `team:${team}`}
              onClick={() => setQueue(`team:${team}`)}
              label={TEAM_LABEL[team]}
              count={counts[`team:${team}`] ?? 0}
            />
          ))}
        </nav>

        {/* Midten: arbeidslisten */}
        <section
          aria-label="Henvendelser"
          className="flex min-h-0 flex-col rounded-[10px] border border-border bg-card"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => patchParams({ q: e.target.value })}
                placeholder="Søk i kunde, emne eller ordrenummer …"
                aria-label="Søk i henvendelser"
                className="h-9 bg-background pl-8"
              />
            </div>
            <select
              value={priority}
              onChange={(e) => patchParams({ prio: e.target.value === "all" ? null : e.target.value })}
              aria-label="Filtrer på prioritet"
              className="h-9 rounded-[10px] border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">Alle prioriteter</option>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>

          {selection.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-2 py-1.5">
              <span className="text-caption font-semibold text-foreground">
                {selection.size} valgt
              </span>
              {(["assign_me", "waiting", "resolve"] as BulkAction[]).map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant="outline"
                  disabled={!canWrite}
                  onClick={() => void bulk(a, Array.from(selection))}
                >
                  {BULK_LABEL[a]}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>
                Nullstill valg
              </Button>
            </div>
          )}

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            <QueryState
              isLoading={isLoading}
              isError={isError}
              error={error}
              scope="ordre:innboks"
              onRetry={() => void refetch()}
              errorTitle="Kunne ikke hente henvendelsene"
              isEmpty={filtered.length === 0}
              emptyTitle={
                search.trim().length >= 2 ? "Ingen treff på søket" : "Ingen saker i denne køen"
              }
              emptyDescription={
                search.trim().length >= 2
                  ? "Prøv et annet søkeord, eller velg en annen kø."
                  : "Velg en annen kø i menyen til venstre."
              }
              emptyIcon={Inbox}
              skeletonRows={6}
              skeletonRowClassName="h-16"
            >
              <>
                <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelection(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())
                    }
                    aria-label="Velg alle synlige henvendelser"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span className="text-caption text-muted-foreground">
                    {filtered.length} sak{filtered.length === 1 ? "" : "er"}
                  </span>
                </div>
                <ul>
                  {filtered.map((row) => (
                    <TicketListRow
                      key={row.id}
                      row={row}
                      active={row.id === selectedId}
                      selected={selection.has(row.id)}
                      canWrite={canWrite}
                      assigneeName={row.assigned_to ? (assigneeNames[row.assigned_to] ?? null) : null}
                      onSelectChange={(checked) =>
                        setSelection((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                      onOpen={() => openTicket(row.id)}
                      onAssignMe={() => void bulk("assign_me", [row.id])}
                      onResolve={() => void bulk("resolve", [row.id])}
                    />
                  ))}
                </ul>
              </>
            </QueryState>
          </div>
        </section>

        {/* Høyre: ticket peek — kun der det er plass til tre paneler */}
        <TicketPeekPanel
          ref={peekRef}
          ticketId={selectedId}
          onClose={() => patchParams({ t: null })}
          className="hidden min-h-0 rounded-[10px] border border-border bg-card xl:block"
        />
      </div>
    </div>
  );
}
