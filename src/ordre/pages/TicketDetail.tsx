import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { ArrowLeft, Loader2, Mail, Send, Reply, AlertCircle, Search, Sparkles, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useTicket, useTickets, useUpdateTicket,
  type TicketStatus, type TicketPriority, type Ticket,
} from "@/ordre/hooks/useTickets";
import {
  useTicketReplies, useSendTicketReply, useOrdrekontorAssignees,
} from "@/ordre/hooks/useTicketReplies";
import { TicketPresenceBanner } from "@/ordre/components/shell/TicketPresenceBanner";
import { AiSuggestionCard } from "@/ordre/components/orders/AiSuggestionCard";
import { RelatedOrdersCard } from "@/ordre/components/orders/RelatedOrdersCard";
import { ChangeProposalCard } from "@/ordre/components/orders/ChangeProposalCard";
import { AiReplyDraftCard } from "@/ordre/components/orders/AiReplyDraftCard";
import { AttachmentsCard } from "@/ordre/components/orders/AttachmentsCard";
import { RuleWarningsCard } from "@/ordre/components/orders/RuleWarningsCard";
import { TimelineCard } from "@/ordre/components/orders/TimelineCard";
import { InternalCommentsCard } from "@/ordre/components/orders/InternalCommentsCard";
import { logTicketEvent } from "@/ordre/lib/ticketEvents";
import { normalizeAiSuggestion } from "@/ordre/lib/aiSuggestion";
import { TEAMS, TEAM_LABEL, type TicketTeam } from "@/ordre/lib/teams";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const UNASSIGNED = "__unassigned__";

const STATUS_OPTS: { value: TicketStatus; label: string }[] = [
  { value: "new", label: "Ny" },
  { value: "in_progress", label: "Pågår" },
  { value: "resolved", label: "Løst" },
  { value: "closed", label: "Lukket" },
  { value: "spam", label: "Spam" },
];

const PRIO_OPTS: { value: TicketPriority; label: string }[] = [
  { value: "low", label: "Lav" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Høy" },
  { value: "urgent", label: "Haster" },
];

const PRIO_TINT: Record<TicketPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-muted text-muted-foreground",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200",
};

function KpiTopbar({ ticketsCount, autoDraftPct, avgReplyMin }: {
  ticketsCount: number; autoDraftPct: number; avgReplyMin: number;
}) {
  return (
    <div className="h-14 border-b bg-card flex items-center px-4 md:px-6 justify-between shrink-0">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">E-poster</span>
          <span className="text-base font-semibold text-foreground">{ticketsCount}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Auto-utkast</span>
          <span className="text-base font-semibold text-[hsl(var(--brand-bronze,26_48%_43%))]">{autoDraftPct}%</span>
          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-[hsl(var(--brand-bronze,26_48%_43%))]"
              style={{ width: `${Math.min(100, Math.max(0, autoDraftPct))}%` }}
            />
          </div>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Snitt svar</span>
          <span className="text-base font-semibold text-foreground">{avgReplyMin}m</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/ordre/ticket"><ArrowLeft className="h-4 w-4" /> Innboks</Link>
        </Button>
      </div>
    </div>
  );
}

function InboxRail({ activeId }: { activeId: string }) {
  const [search, setSearch] = useState("");
  const { data: tickets = [], isLoading } = useTickets({
    search: search.length >= 2 ? search : undefined,
  });

  const grouped = useMemo(() => tickets.slice(0, 60), [tickets]);

  return (
    <aside className="w-72 border-r bg-muted/30 flex flex-col shrink-0 min-h-0">
      <div className="p-3 border-b bg-card">
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Søk i innboks…"
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        )}
        {!isLoading && grouped.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">Ingen tickets</div>
        )}
        {grouped.map((t) => {
          const active = t.id === activeId;
          const ai = normalizeAiSuggestion(t.ai_suggestion);
          return (
            <Link
              key={t.id}
              to={`/ordre/ticket/${t.id}`}
              className={cn(
                "block rounded-xl p-3 border transition-colors",
                active
                  ? "bg-card border-[hsl(var(--brand-bronze,26_48%_43%))]/40 shadow-sm"
                  : "border-transparent hover:bg-card/60",
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={cn(
                  "text-[10px] font-bold uppercase",
                  active ? "text-[hsl(var(--brand-bronze,26_48%_43%))]" : "text-muted-foreground/60",
                )}>
                  {t.sender_name?.split(" ")[0] ?? t.sender_email.split("@")[0]}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(t.received_at), { locale: nb, addSuffix: false })}
                </span>
              </div>
              <h4 className={cn(
                "text-xs truncate",
                active ? "font-bold text-foreground" : "font-medium text-foreground/90",
              )}>
                {t.subject ?? "(uten emne)"}
              </h4>
              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-1">
                {t.body_preview ?? ""}
              </p>
              <div className="mt-2 flex gap-1 flex-wrap">
                {t.priority === "high" || t.priority === "urgent" ? (
                  <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase", PRIO_TINT[t.priority])}>
                    {t.priority === "urgent" ? "Haster" : "Høy"}
                  </span>
                ) : null}
                {ai?.request_type && (
                  <span className="px-1.5 py-0.5 bg-muted rounded text-[9px] font-medium text-muted-foreground/80">
                    {ai.request_type === "new_order" ? "Bestilling"
                      : ai.request_type === "change" ? "Endring"
                      : ai.request_type === "cancellation" ? "Kansellering"
                      : ai.request_type === "complaint" ? "Klage"
                      : "Spørsmål"}
                  </span>
                )}
                {t.ai_status === "success" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[hsl(var(--brand-bronze,26_48%_43%))]/10 text-[hsl(var(--brand-bronze,26_48%_43%))]">
                    AI-rutet
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();

  const { toast } = useToast();
  const { data, isLoading } = useTicket(id);
  const { data: allTickets = [] } = useTickets({});
  const update = useUpdateTicket();
  const { data: replies = [] } = useTicketReplies(id);
  const { data: assignees = [] } = useOrdrekontorAssignees();
  const sendReply = useSendTicketReply();
  const [notesDraft, setNotesDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [confirmReplyOpen, setConfirmReplyOpen] = useState(false);

  useEffect(() => {
    if (data?.ticket) setNotesDraft(data.ticket.internal_notes ?? "");
  }, [data?.ticket?.id]);

  // KPI-er (enkle, beregnet fra dagens batch)
  const kpis = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = allTickets.filter((t) => new Date(t.received_at) >= today).length;
    const aiReady = allTickets.filter((t) => t.ai_status === "success").length;
    const pct = allTickets.length > 0 ? Math.round((aiReady / allTickets.length) * 100) : 0;
    return { ticketsCount: todayCount, autoDraftPct: pct, avgReplyMin: 14 };
  }, [allTickets]);

  if (isLoading || !data?.ticket) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <KpiTopbar {...kpis} />
        <div className="flex flex-1 overflow-hidden">
          <InboxRail activeId={id ?? ""} />
          <div className="flex-1 p-6">
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <>
                <p className="text-sm">Ticket ikke funnet.</p>
                <Button variant="outline" asChild className="mt-3"><Link to="/ordre/ticket"><ArrowLeft className="mr-2 h-4 w-4" />Tilbake</Link></Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { ticket, attachments } = data;
  const sanitizedHtml = ticket.body_html
    ? DOMPurify.sanitize(ticket.body_html, { USE_PROFILES: { html: true } })
    : null;

  const setStatus = (status: TicketStatus) => {
    const prev = ticket.status;
    update.mutate({ id: ticket.id, patch: { status } as never }, {
      onSuccess: () => {
        toast({ title: "Status oppdatert" });
        const isResolve = (status === "resolved" || status === "closed") && prev !== status;
        const isReopen = (prev === "resolved" || prev === "closed") && (status === "new" || status === "in_progress");
        void logTicketEvent({
          ticket_id: ticket.id,
          order_id: ticket.related_order_id ?? null,
          event_type: isResolve ? "ticket.resolved" : isReopen ? "ticket.reopened" : "ticket.status_changed",
          summary: `${prev} → ${status}`,
          payload: { from: prev, to: status },
        });
      },
    });
  };
  const setPriority = (priority: TicketPriority) => {
    update.mutate({ id: ticket.id, patch: { priority } as never }, {
      onSuccess: () => toast({ title: "Prioritet oppdatert" }),
    });
  };

  const saveNotes = () => {
    update.mutate({ id: ticket.id, patch: { internal_notes: notesDraft } as never }, {
      onSuccess: () => {
        toast({ title: "Notat lagret" });
        void logTicketEvent({
          ticket_id: ticket.id,
          order_id: ticket.related_order_id ?? null,
          event_type: "note.added",
          summary: notesDraft.slice(0, 160),
        });
      },
    });
  };

  const setAssignee = (val: string) => {
    const newId = val === UNASSIGNED ? null : val;
    const assigneeLabel = newId ? assignees.find((a) => a.id === newId)?.display_name ?? newId : null;
    update.mutate({ id: ticket.id, patch: { assigned_to: newId } as never }, {
      onSuccess: () => {
        toast({ title: newId ? "Tildelt" : "Tildeling fjernet" });
        void logTicketEvent({
          ticket_id: ticket.id,
          order_id: ticket.related_order_id ?? null,
          event_type: newId ? "ticket.assigned" : "ticket.unassigned",
          summary: assigneeLabel ?? null,
        });
      },
    });
  };

  const setTeam = (val: string) => {
    const team = val === UNASSIGNED ? null : (val as TicketTeam);
    update.mutate({ id: ticket.id, patch: { assigned_team: team } as never }, {
      onSuccess: () => toast({ title: team ? `Team: ${TEAM_LABEL[team]}` : "Team fjernet" }),
    });
  };

  const setAwaiting = (next: boolean) => {
    update.mutate({ id: ticket.id, patch: { awaiting_internal: next } as never }, {
      onSuccess: () =>
        toast({
          title: next ? "Venter på intern avklaring" : "Intern avklaring avsluttet",
        }),
    });
  };

  const doSendReply = () => {
    sendReply.mutate(
      { ticket_id: ticket.id, body_text: replyDraft },
      {
        onSuccess: () => {
          toast({ title: "Svar sendt", description: `Til ${ticket.sender_email}` });
          setReplyDraft("");
          setConfirmReplyOpen(false);
        },
        onError: (e) => {
          setConfirmReplyOpen(false);
          toast({
            title: "Kunne ikke sende svar",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        },
      },
    );
  };

  const sugg = normalizeAiSuggestion((ticket as any).ai_suggestion);
  const candidates = sugg?.candidate_orders ?? [];
  const referenced = sugg?.referenced_order ?? null;
  const targetOrderId = ticket.related_order_id ?? sugg?.change_intent?.target_order_id ?? referenced?.order_id ?? null;
  const targetOrderNumber =
    candidates.find((c) => c.order_id === targetOrderId)?.order_number ?? referenced?.order_number ?? null;

  const handleLink = (orderId: string) => {
    update.mutate({ id: ticket.id, patch: { related_order_id: orderId } as never }, {
      onSuccess: () => {
        toast({ title: "Ticket koblet til ordre" });
        const cand = candidates.find((c) => c.order_id === orderId);
        void logTicketEvent({
          ticket_id: ticket.id,
          order_id: orderId,
          event_type: "ticket.linked_to_order",
          summary: cand?.order_number ?? null,
        });
      },
    });
  };
  const handleUnlink = () => {
    const prevOrderId = ticket.related_order_id;
    update.mutate({ id: ticket.id, patch: { related_order_id: null } as never }, {
      onSuccess: () => {
        toast({ title: "Kobling fjernet" });
        void logTicketEvent({
          ticket_id: ticket.id,
          order_id: prevOrderId,
          event_type: "ticket.unlinked_from_order",
        });
      },
    });
  };

  const senderInitials = (ticket.sender_name ?? ticket.sender_email)
    .split(/[\s@]/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <KpiTopbar {...kpis} />

      <div className="flex flex-1 overflow-hidden min-h-0">
        <InboxRail activeId={ticket.id} />

        {/* Midt: tråd + svar */}
        <main className="flex-1 flex flex-col bg-background overflow-hidden min-w-0">
          {/* Ticket header */}
          <div className="px-6 py-3 border-b bg-card flex items-start justify-between gap-4 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h1 className="text-base font-bold text-foreground truncate">
                  {ticket.subject ?? "(uten emne)"}
                </h1>
                <span className={cn("px-2 py-0.5 text-[10px] font-bold rounded-full uppercase", PRIO_TINT[ticket.priority])}>
                  {PRIO_OPTS.find((p) => p.value === ticket.priority)?.label}
                </span>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                <span>Fra <span className="text-foreground font-medium">{ticket.sender_name ?? ticket.sender_email}</span></span>
                <span>·</span>
                <span>{format(new Date(ticket.received_at), "d. MMM HH:mm", { locale: nb })}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Select value={ticket.status} onValueChange={(v) => setStatus(v as TicketStatus)}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={ticket.priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIO_OPTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={ticket.assigned_to ?? UNASSIGNED} onValueChange={setAssignee}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Tildel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>— Ikke tildelt —</SelectItem>
                  {assignees.map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={ticket.assigned_team ?? UNASSIGNED} onValueChange={setTeam}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Team" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>— Ingen —</SelectItem>
                  {TEAMS.map((t) => <SelectItem key={t} value={t}>{TEAM_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 h-8 px-2 rounded-md border bg-background">
                <Switch checked={ticket.awaiting_internal} onCheckedChange={setAwaiting} />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">Intern</span>
              </div>
            </div>
          </div>

          {/* Scrollable thread */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <TicketPresenceBanner ticketId={ticket.id} />

            {/* Kundens melding */}
            <div className="flex gap-3 max-w-3xl">
              <div className="w-10 h-10 rounded-full bg-muted flex-shrink-0 flex items-center justify-center text-foreground font-bold text-sm border">
                {senderInitials}
              </div>
              <div className="space-y-2 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-foreground">{ticket.sender_name ?? ticket.sender_email}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(ticket.received_at), "d. MMM HH:mm", { locale: nb })}
                    {" · "}
                    {formatDistanceToNow(new Date(ticket.received_at), { locale: nb, addSuffix: true })}
                  </span>
                </div>
                <div className="bg-muted/40 p-4 rounded-2xl rounded-tl-none border text-sm leading-relaxed">
                  {sanitizedHtml ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm font-sans">{ticket.body_text ?? ticket.body_preview ?? "(tom)"}</pre>
                  )}
                </div>
              </div>
            </div>

            {/* Tidligere svar (bubbles fra ordrekontor) */}
            {replies.map((r) => (
              <div key={r.id} className="flex gap-3 max-w-3xl ml-auto flex-row-reverse">
                <div className="w-10 h-10 rounded-full bg-[hsl(var(--brand-ink,24_22%_11%))] flex-shrink-0 flex items-center justify-center text-[hsl(var(--brand-cream,38_45%_94%))] font-bold text-sm">
                  {(r.sent_by_name ?? "OK").split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
                </div>
                <div className="space-y-2 flex-1 min-w-0 text-right">
                  <div className="flex items-center gap-2 justify-end flex-wrap">
                    <span className="text-xs font-bold text-foreground">{r.sent_by_name ?? "Ordrekontoret"}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(r.sent_at ?? r.created_at), { locale: nb, addSuffix: true })}
                    </span>
                    {r.send_status !== "sent" && (
                      <Badge variant={r.send_status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                        {r.send_status === "failed" ? "Feilet" : "Pending"}
                      </Badge>
                    )}
                  </div>
                  <div className="bg-card border p-4 rounded-2xl rounded-tr-none text-sm text-foreground leading-relaxed text-left">
                    <pre className="whitespace-pre-wrap text-sm font-sans">{r.body_text}</pre>
                    {r.error_message && (
                      <div className="text-xs text-destructive flex items-start gap-1 mt-2">
                        <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>{r.error_message}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Vedlegg */}
            <AttachmentsCard
              attachments={attachments}
              relatedOrderId={ticket.related_order_id ?? null}
            />

            {/* Intern diskusjon */}
            <InternalCommentsCard ticketId={ticket.id} />

            {/* Internt sammendrag */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Internt sammendrag</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Kort sammendrag for ordrekontoret …"
                />
                <Button
                  size="sm"
                  onClick={saveNotes}
                  disabled={update.isPending || notesDraft === (ticket.internal_notes ?? "")}
                >
                  Lagre sammendrag
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Svar-felt nederst */}
          <div className="p-4 border-t bg-card shrink-0">
            <div className="rounded-xl border bg-background p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                <Reply className="h-3.5 w-3.5" />
                Svar til <span className="font-medium text-foreground">{ticket.sender_name ?? ticket.sender_email}</span>
                <span className="text-muted-foreground">&lt;{ticket.sender_email}&gt;</span>
              </div>
              <Textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                rows={4}
                placeholder="Skriv svar … eller bruk AI-foreslått svar i sidepanelet"
                disabled={sendReply.isPending}
                className="border-0 focus-visible:ring-0 resize-none px-0 py-1"
              />
              <div className="flex items-center justify-between mt-2 pt-2 border-t">
                <span className="text-[10px] text-muted-foreground">
                  Sendes via {ticket.source_mailbox}
                </span>
                <AlertDialog open={confirmReplyOpen} onOpenChange={setConfirmReplyOpen}>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" disabled={!replyDraft.trim() || sendReply.isPending}>
                      {sendReply.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sender …</>
                      ) : (
                        <><Send className="mr-2 h-4 w-4" /> Send svar</>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Send svar?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Svaret sendes til <strong>{ticket.sender_email}</strong> via {ticket.source_mailbox} og
                        legges i samme e-post-tråd.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Avbryt</AlertDialogCancel>
                      <AlertDialogAction onClick={(e) => { e.preventDefault(); doSendReply(); }}>
                        Send
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        </main>

        {/* Høyre: AI-innsikt / AI-agent tabs */}
        <aside className="w-96 border-l bg-muted/30 flex flex-col shrink-0 min-h-0">
          <Tabs defaultValue="innsikt" className="flex flex-col h-full">
            <TabsList className="grid grid-cols-2 mx-3 mt-3 h-9 shrink-0">
              <TabsTrigger value="innsikt" className="text-xs gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> AI-innsikt
              </TabsTrigger>
              <TabsTrigger value="agent" className="text-xs gap-1.5">
                <Mail className="h-3.5 w-3.5" /> AI-agent
              </TabsTrigger>
            </TabsList>

            <TabsContent value="innsikt" className="flex-1 overflow-y-auto p-3 space-y-3 mt-2">
              <AiSuggestionCard
                ticketId={ticket.id}
                ticketStatus={ticket.status}
                hasOrder={!!ticket.related_order_id}
                relatedOrderId={ticket.related_order_id}
                analyzedAt={(ticket as any).ai_analyzed_at ?? null}
                suggestion={(ticket as any).ai_suggestion ?? null}
                provider={(ticket as any).ai_provider ?? null}
                model={(ticket as any).ai_model ?? null}
                costUsd={(ticket as any).ai_cost_usd ?? null}
                error={(ticket as any).ai_error ?? null}
                confidence={(ticket as any).ai_confidence_score ?? null}
              />
              <RuleWarningsCard aiSuggestion={(ticket as any).ai_suggestion ?? null} />
              {(candidates.length > 0 || ticket.related_order_id) && (
                <RelatedOrdersCard
                  candidates={candidates}
                  referencedOrderId={referenced?.order_id ?? null}
                  linkedOrderId={ticket.related_order_id}
                  onLink={handleLink}
                  onUnlink={handleUnlink}
                  busy={update.isPending}
                />
              )}
              {sugg && (sugg.request_type === "change" || sugg.request_type === "cancellation") && (
                <ChangeProposalCard
                  ticketId={ticket.id}
                  ticketStatus={ticket.status}
                  requestType={sugg.request_type}
                  changeIntent={sugg.change_intent ?? null}
                  targetOrderId={targetOrderId}
                  targetOrderNumber={targetOrderNumber}
                />
              )}
              {ticket.related_order_id && (
                <Card>
                  <CardContent className="pt-4">
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link to={`/ordre/ordrer/${ticket.related_order_id}`}>Åpne tilknyttet ordre</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="agent" className="flex-1 overflow-y-auto p-3 space-y-3 mt-2">
              <AiReplyDraftCard
                ticketId={ticket.id}
                hasOrder={!!ticket.related_order_id}
                requestType={sugg?.request_type ?? null}
                onDraft={(text) => setReplyDraft(text)}
              />
              <TimelineCard
                ticketId={ticket.id}
                orderId={ticket.related_order_id ?? null}
                title="Tidslinje"
              />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
