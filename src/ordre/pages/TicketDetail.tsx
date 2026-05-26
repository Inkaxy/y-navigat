import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { ArrowLeft, Loader2, Mail, Send, Reply, AlertCircle } from "lucide-react";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useTicket, useUpdateTicket,
  type TicketStatus, type TicketPriority,
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
import { logTicketEvent } from "@/ordre/lib/ticketEvents";
import { normalizeAiSuggestion } from "@/ordre/lib/aiSuggestion";

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

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  
  const { toast } = useToast();
  const { data, isLoading } = useTicket(id);
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

  if (isLoading) {
    return (
      <>
        <AppBanner title="Ticket" />
        <div className="container mx-auto p-6 space-y-3"><Skeleton className="h-40 w-full" /></div>
      </>
    );
  }
  if (!data?.ticket) {
    return (
      <>
        <AppBanner title="Ticket" />
        <div className="container mx-auto p-6">
          <p>Ticket ikke funnet.</p>
          <Button variant="outline" asChild className="mt-3"><Link to="/ordre/ticket"><ArrowLeft className="mr-2 h-4 w-4" />Tilbake</Link></Button>
        </div>
      </>
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

  return (
    <>
      <AppBanner
        title={ticket.subject ?? "(uten emne)"}
        subtitle={`Fra ${ticket.sender_email}`}
        actions={
          <Button asChild variant="outline" size="sm" className="gap-2 border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white">
            <Link to="/ordre/ticket"><ArrowLeft className="h-4 w-4" /> Tilbake</Link>
          </Button>
        }
      />
      <div className="container mx-auto max-w-7xl p-4 space-y-4">
        {/* Sanntids-presence */}
        <TicketPresenceBanner ticketId={ticket.id} />

        {/* Handlings-rad: status / prioritet / tildelt */}
        <Card>
          <CardContent className="pt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={ticket.status} onValueChange={(v) => setStatus(v as TicketStatus)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prioritet</Label>
              <Select value={ticket.priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIO_OPTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tildelt</Label>
              <Select value={ticket.assigned_to ?? UNASSIGNED} onValueChange={setAssignee}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>— Ikke tildelt —</SelectItem>
                  {assignees.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignees.length === 0 && (
                <p className="text-[11px] text-muted-foreground max-w-[14rem]">
                  Ingen brukere har ordrekontor-rollen ennå. Tildel i Admin → Brukere.
                </p>
              )}
            </div>
            {ticket.related_order_id && (
              <div className="ml-auto">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/ordre/ordrer/${ticket.related_order_id}`}>Vis tilknyttet ordre</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Split-view: kommunikasjon ⟷ AI-panel */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] gap-4 items-start">
          {/* Venstre: kundekommunikasjon */}
          <div className="space-y-4 min-w-0">
            {/* E-post-tråd */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" />
                  {ticket.subject ?? "(uten emne)"}
                </CardTitle>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div><strong>Fra:</strong> {ticket.sender_name ? `${ticket.sender_name} <${ticket.sender_email}>` : ticket.sender_email}</div>
                  <div><strong>Mottatt:</strong> {format(new Date(ticket.received_at), "d. MMM yyyy HH:mm", { locale: nb })} ({formatDistanceToNow(new Date(ticket.received_at), { locale: nb, addSuffix: true })})</div>
                  {Array.isArray(ticket.to_recipients) && ticket.to_recipients.length > 0 && (
                    <div><strong>Til:</strong> {(ticket.to_recipients as Array<{ emailAddress?: { address?: string } }>).map((r) => r?.emailAddress?.address).filter(Boolean).join(", ")}</div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {sanitizedHtml ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm font-sans">{ticket.body_text ?? ticket.body_preview ?? "(tom)"}</pre>
                )}
              </CardContent>
            </Card>

            {/* Vedlegg */}
            <AttachmentsCard
              attachments={attachments}
              relatedOrderId={ticket.related_order_id ?? null}
            />


            {/* Tidligere svar */}
            {replies.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Reply className="h-4 w-4" /> Sendte svar ({replies.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {replies.map((r) => (
                    <div key={r.id} className="border-l-2 border-primary/40 pl-3 space-y-1">
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">{r.sent_by_name ?? "Bruker"}</span>
                        <span>·</span>
                        <span>{formatDistanceToNow(new Date(r.sent_at ?? r.created_at), { locale: nb, addSuffix: true })}</span>
                        {r.send_status !== "sent" && (
                          <Badge variant={r.send_status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                            {r.send_status === "failed" ? "Feilet" : "Pending"}
                          </Badge>
                        )}
                      </div>
                      <pre className="whitespace-pre-wrap text-sm font-sans">{r.body_text}</pre>
                      {r.error_message && (
                        <div className="text-xs text-destructive flex items-start gap-1">
                          <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span>{r.error_message}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Svar-felt */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Reply className="h-4 w-4" />
                  Svar til {ticket.sender_name ?? ticket.sender_email}{" "}
                  <span className="text-xs font-normal text-muted-foreground">&lt;{ticket.sender_email}&gt;</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  rows={8}
                  placeholder="Skriv svar …"
                  disabled={sendReply.isPending}
                />
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
              </CardContent>
            </Card>

            {/* Internt notat */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Internt notat</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={4}
                  placeholder="Notater for ordrekontoret …"
                />
                <Button
                  size="sm"
                  onClick={saveNotes}
                  disabled={update.isPending || notesDraft === (ticket.internal_notes ?? "")}
                >
                  Lagre notat
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Høyre: AI-panel */}
          <div className="min-w-0 space-y-4">
            {(() => {
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
              return (
                <>
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
                  <AiReplyDraftCard
                    ticketId={ticket.id}
                    hasOrder={!!ticket.related_order_id}
                    requestType={sugg?.request_type ?? null}
                    onDraft={(text) => setReplyDraft(text)}
                  />
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
                  <TimelineCard
                    ticketId={ticket.id}
                    orderId={ticket.related_order_id ?? null}
                    title="Tidslinje"
                  />
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </>
  );
}
