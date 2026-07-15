import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  StickyNote,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useTicket,
  useUpdateTicket,
  getTicketAttachmentSignedUrl,
} from "@/ordre/hooks/useTickets";
import {
  useTicketReplies,
  useSendTicketReply,
} from "@/ordre/hooks/useTicketReplies";
import {
  useInternalComments,
  useAddInternalComment,
} from "@/ordre/hooks/useInternalComments";
import {
  normalizeAiSuggestion,
  REQUEST_TYPE_LABEL,
  REQUEST_TYPE_BADGE,
} from "@/ordre/lib/aiSuggestion";
import type { TicketAttachment } from "@/ordre/hooks/useTickets";
import ChangeIntentCard from "@/ordre/components/tickets/ChangeIntentCard";
import LinkOrderSearch from "@/ordre/components/tickets/LinkOrderSearch";
import CreateOrderFromTicketButton from "@/ordre/components/tickets/CreateOrderFromTicketButton";
import TicketComposerActions from "@/ordre/components/tickets/TicketComposerActions";
import { CakeImageStatusCard } from "@/ordre/components/orders/CakeImageStatusCard";
import { useInboundMessages, type InboundMessage } from "@/ordre/hooks/useInboundMessages";
import CreateRefundDialog from "@/ordre/components/tickets/CreateRefundDialog";
import RefundStatusCard from "@/ordre/components/tickets/RefundStatusCard";

// ────────────────────────── helpers

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `i dag ${format(d, "HH:mm")}`;
  return format(d, "d. MMM HH:mm", { locale: nb });
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ["style", "onerror", "onclick"],
  });
}

function initials(name: string | null, email?: string | null): string {
  const src = (name ?? email ?? "?").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

// ────────────────────────── data hooks

interface TicketEvent {
  id: string;
  event_type: string;
  summary: string | null;
  actor_label: string | null;
  occurred_at: string;
}

function useTicketEvents(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ["ticket-events", ticketId],
    queryFn: async (): Promise<TicketEvent[]> => {
      const { data, error } = await supabase
        .from("ticket_events")
        .select("id, event_type, summary, actor_label, occurred_at")
        .eq("ticket_id", ticketId!)
        .order("occurred_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TicketEvent[];
    },
  });
}

function useCustomerCard(senderEmail: string | undefined) {
  return useQuery({
    enabled: !!senderEmail,
    queryKey: ["ticket-customer-card", senderEmail],
    queryFn: async () => {
      const email = senderEmail!.toLowerCase();
      const { data: byPrimary } = await supabase
        .from("customers")
        .select(
          "id, customer_number, display_name, primary_contact_email, primary_contact_phone",
        )
        .ilike("primary_contact_email", email)
        .limit(1);
      let customer = (byPrimary ?? [])[0] ?? null;
      if (!customer) {
        const { data: contact } = await supabase
          .from("customer_contacts")
          .select(
            "customer_id, phone, mobile, customers:customer_id(id, customer_number, display_name, primary_contact_phone)",
          )
          .ilike("email", email)
          .limit(1);
        const row = (contact ?? [])[0] as
          | {
              customer_id: string;
              phone: string | null;
              mobile: string | null;
              customers: {
                id: string;
                customer_number: string;
                display_name: string;
                primary_contact_phone: string | null;
              } | null;
            }
          | undefined;
        if (row?.customers) {
          customer = {
            id: row.customers.id,
            customer_number: row.customers.customer_number,
            display_name: row.customers.display_name,
            primary_contact_email: email,
            primary_contact_phone:
              row.mobile ?? row.phone ?? row.customers.primary_contact_phone,
          };
        }
      }
      if (!customer) return { customer: null, orderCount: 0 };

      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customer.id)
        .gte("ordered_at", since.toISOString());
      return { customer, orderCount: count ?? 0 };
    },
  });
}

function useLinkedOrder(orderId: string | null) {
  return useQuery({
    enabled: !!orderId,
    queryKey: ["ticket-linked-order", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, delivery_date, delivery_time, subtotal_excl_vat, total_incl_vat, legal_entity_id, order_lines:order_lines(quantity, product_name:internal_notes)",
        )
        .eq("id", orderId!)
        .maybeSingle();
      if (error) throw error;
      // Also count lines
      const { data: lines } = await supabase
        .from("order_lines")
        .select("quantity, product_snapshot, notes")
        .eq("order_id", orderId!)
        .limit(6);
      return { order: data, lines: (lines ?? []) as Array<{ quantity: number; product_snapshot: { name?: string } | null; notes: string | null }> };
    },
  });
}

// ────────────────────────── attachment thumbnail

function AttachmentThumb({
  att,
  onOpen,
}: {
  att: TicketAttachment;
  onOpen: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getTicketAttachmentSignedUrl(att.id, { inline: true })
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [att.id]);

  const isImage = (att.content_type ?? "").startsWith("image/");
  return (
    <button
      type="button"
      onClick={() => url && onOpen(url, att.file_name)}
      className="group flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-xs hover:bg-muted"
    >
      {isImage && url ? (
        <img
          src={url}
          alt={att.file_name}
          className="h-10 w-10 rounded object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{att.file_name}</div>
        {att.size_bytes && (
          <div className="text-[10px] text-muted-foreground">
            {(att.size_bytes / 1024).toFixed(0)} kB
          </div>
        )}
      </div>
    </button>
  );
}

// ────────────────────────── side cards

function SideCard({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-[hsl(var(--brand-cream))] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// ────────────────────────── main page

type ThreadItem =
  | { kind: "email"; at: string; node: React.ReactNode }
  | { kind: "reply"; at: string; node: React.ReactNode }
  | { kind: "note"; at: string; node: React.ReactNode }
  | { kind: "event"; at: string; node: React.ReactNode };

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: ticketData, isLoading } = useTicket(id);
  const ticket = ticketData?.ticket ?? null;
  const attachments = ticketData?.attachments ?? [];
  const { data: replies = [] } = useTicketReplies(id);
  const { data: comments = [] } = useInternalComments(id);
  const { data: events = [] } = useTicketEvents(id);
  const { data: inboundMessages = [] } = useInboundMessages(id);
  const { data: customerCard } = useCustomerCard(ticket?.sender_email);
  const { data: linked } = useLinkedOrder(ticket?.related_order_id ?? null);

  const updateTicket = useUpdateTicket();
  const sendReply = useSendTicketReply();
  const addComment = useAddInternalComment();

  const [replyText, setReplyText] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(
    null,
  );

  // Realtime updates for thread
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`ticket-detail-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_replies", filter: `ticket_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["ticket-replies", id] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ticket_internal_comments",
          filter: `ticket_id=eq.${id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["ticket-internal-comments", id] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_events", filter: `ticket_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["ticket-events", id] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_inbound_messages", filter: `ticket_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["ticket-inbound-messages", id] });
          qc.invalidateQueries({ queryKey: ["ticket", id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, qc]);

  const ai = useMemo(() => normalizeAiSuggestion(ticket?.ai_suggestion), [ticket]);

  const attachmentsByCreated = useMemo(() => {
    // We just show all attachments under the incoming email.
    return attachments;
  }, [attachments]);

  const threadItems: ThreadItem[] = useMemo(() => {
    const items: ThreadItem[] = [];
    if (ticket) {
      items.push({
        kind: "email",
        at: ticket.received_at,
        node: <IncomingEmail ticket={ticket} attachments={attachmentsByCreated} onOpen={setLightbox} />,
      });
    }
    for (const r of replies) {
      items.push({
        kind: "reply",
        at: r.created_at,
        node: <ReplyBubble r={r} />,
      });
    }
    for (const c of comments) {
      items.push({
        kind: "note",
        at: c.created_at,
        node: <InternalNoteBubble c={c} />,
      });
    }
    for (const m of inboundMessages) {
      items.push({
        kind: "email",
        at: m.received_at,
        node: <InboundMessageBubble m={m} />,
      });
    }
    for (const e of events) {
      items.push({
        kind: "event",
        at: e.occurred_at,
        node: <EventBubble e={e} />,
      });
    }
    items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return items;
  }, [ticket, attachmentsByCreated, replies, comments, events, inboundMessages]);

  if (isLoading || !ticket) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Laster ticket…
      </div>
    );
  }

  // ─── handlers

  const onSendReply = async () => {
    if (!replyText.trim() || !id) return;
    try {
      // Note: microsoft-graph-reply-ticket accepts body_html. We send simple <p> paragraphs.
      const html = replyText
        .trim()
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
        .join("");
      const { data, error } = await supabase.functions.invoke(
        "microsoft-graph-reply-ticket",
        { body: { ticket_id: id, body_html: html } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Log reply in ticket_replies (mirror local state)
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("ticket_replies").insert({
        ticket_id: id,
        body_text: replyText.trim(),
        body_rendered: html,
        sent_by: u.user?.id ?? "",
        send_status: "sent",
        sent_at: new Date().toISOString(),
      } as never);
      // Automatically flag "venter på kunde" via awaiting_internal=false + status in_progress
      await updateTicket.mutateAsync({
        id,
        patch: { status: "in_progress", awaiting_internal: false } as never,
      });
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["ticket-replies", id] });
      toast.success("Svar sendt til kunde");
    } catch (e) {
      toast.error(`Kunne ikke sende: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onAiDraft = async () => {
    if (!id) return;
    setDraftLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-ticket-reply",
        {
          body: { ticket_id: id, reply_type: "reply" },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const draft = (data?.draft ?? {}) as { body_text?: string };
      if (draft.body_text) setReplyText(draft.body_text);
      toast.success("AI-utkast satt inn — rediger før sending");
    } catch (e) {
      toast.error(`AI-utkast feilet: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDraftLoading(false);
    }
  };

  const onSaveInternalNote = async () => {
    if (!replyText.trim() || !id) return;
    try {
      await addComment.mutateAsync({
        ticket_id: id,
        body: replyText.trim(),
        mentioned_teams: [],
      });
      if (ticket?.awaiting_internal) {
        await updateTicket.mutateAsync({
          id,
          patch: { awaiting_internal: false } as never,
        });
      }
      setReplyText("");
      toast.success("Internt notat lagret");
    } catch (e) {
      toast.error(`Feil: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onMarkResolved = async () => {
    if (!id) return;
    await updateTicket.mutateAsync({ id, patch: { status: "resolved" } as never });
    toast.success("Ticket markert som løst");
  };

  const statusLabel: Record<string, string> = {
    new: "ÅPEN",
    in_progress: "PÅGÅR",
    resolved: "LØST",
    closed: "LUKKET",
    spam: "SPAM",
  };
  const intent = ai?.request_type ?? null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[hsl(var(--brand-cream))] text-xl">
          ✏️
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {ticket.subject || "(uten emne)"}
            </h1>
            {intent && (
              <span
                className={cn(
                  "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  REQUEST_TYPE_BADGE[intent],
                )}
              >
                {REQUEST_TYPE_LABEL[intent]}
              </span>
            )}
            <span className="inline-flex items-center rounded border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {statusLabel[ticket.status] ?? ticket.status}
            </span>
            {ticket.awaiting_internal && (
              <span className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                ⏳ venter på @intern
              </span>
            )}
            {ticket.awaiting_external && (
              <span className="inline-flex items-center rounded border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
                ⏳ venter på ekstern{ticket.awaiting_external_email ? ` · ${ticket.awaiting_external_email}` : ""}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {ticket.sender_name ?? ticket.sender_email} · {fmtTime(ticket.received_at)}
          </p>
        </div>
        <Button
          variant="default"
          className="gap-2"
          onClick={onMarkResolved}
          disabled={updateTicket.isPending || ticket.status === "resolved"}
        >
          <CheckCircle2 className="h-4 w-4" />
          Marker som løst
        </Button>
      </div>

      <Link
        to="/ordre/ticket"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Tilbake til innboksen
      </Link>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Thread */}
        <div className="space-y-3">
          {threadItems.map((it, i) => (
            <div key={i}>{it.node}</div>
          ))}

          {/* Reply composer */}
          <div className="rounded-lg border bg-[hsl(var(--brand-cream))] p-4 shadow-sm">
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Skriv svar til kunden … (eller trykk ✨ for AI-utkast basert på mal + ordredata)"
              className="min-h-[130px] resize-y bg-background"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={onSendReply} disabled={!replyText.trim() || sendReply.isPending} className="gap-2">
                <Send className="h-4 w-4" /> Send svar
              </Button>
              <Button variant="outline" onClick={onAiDraft} disabled={draftLoading} className="gap-2">
                {draftLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Sett inn AI-utkast
              </Button>
              <Button
                variant="outline"
                onClick={onSaveInternalNote}
                disabled={!replyText.trim() || addComment.isPending}
                className="gap-2"
              >
                <StickyNote className="h-4 w-4" /> Lagre som internt notat
              </Button>
            </div>
            <TicketComposerActions
              ticket={ticket}
              replyText={replyText}
              onConsumeReplyText={() => setReplyText("")}
              linkedOrderNumber={linked?.order?.order_number ?? null}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-3">
          <SideCard label="Kunde">
            {customerCard?.customer ? (
              <div className="space-y-1 text-sm">
                <div className="font-semibold text-foreground">
                  {customerCard.customer.display_name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    · {customerCard.customer.customer_number}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {customerCard.customer.primary_contact_email}
                  {customerCard.customer.primary_contact_phone
                    ? ` · ${customerCard.customer.primary_contact_phone}`
                    : ""}
                </div>
                <div className="pt-1 text-xs text-muted-foreground">
                  {customerCard.orderCount} ordrer siste 12 mnd
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Ikke i registeret
                </div>
                <div className="text-xs text-muted-foreground">
                  {ticket.sender_name ?? ticket.sender_email}
                </div>
                <div className="text-xs text-muted-foreground">{ticket.sender_email}</div>
              </div>
            )}
          </SideCard>

          {ai && (
            <SideCard
              label="AI-analyse"
              right={
                ticket.ai_confidence_score != null ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    Konfidens {Math.round(Number(ticket.ai_confidence_score) * (Number(ticket.ai_confidence_score) > 1 ? 1 : 100))}%
                  </span>
                ) : null
              }
            >
              <div className="space-y-2 text-sm">
                {intent && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase",
                      REQUEST_TYPE_BADGE[intent],
                    )}
                  >
                    {REQUEST_TYPE_LABEL[intent]}
                  </span>
                )}
                {ai.summary && <p className="text-foreground">{ai.summary}</p>}
                {ai.risks?.length > 0 && (
                  <div className="space-y-1">
                    {ai.risks.map((r, i) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded border px-2 py-1.5 text-xs",
                          r.severity === "red"
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
                        )}
                      >
                        ⚠️ {r.message}
                      </div>
                    ))}
                  </div>
                )}
                {intent === "new_order" && !linked?.order && id && (
                  <CreateOrderFromTicketButton
                    ticket={ticket}
                    ai={ai}
                    attachments={attachments}
                    onCreated={() => {
                      qc.invalidateQueries({ queryKey: ["ticket", id] });
                      qc.invalidateQueries({ queryKey: ["ticket-events", id] });
                      qc.invalidateQueries({ queryKey: ["cake-images-for", id] });
                    }}
                  />
                )}
              </div>
            </SideCard>
          )}

          {linked?.order ? (
            <SideCard label="Koblet ordre">
              <div className="space-y-2 text-sm">
                <div className="font-semibold text-foreground">
                  #{linked.order.order_number}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    · {linked.order.status}
                  </span>
                </div>
                {linked.order.delivery_date && (
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(linked.order.delivery_date), "eeee d. MMM", {
                      locale: nb,
                    })}
                    {linked.order.delivery_time ? ` kl. ${linked.order.delivery_time.slice(0, 5)}` : ""}
                  </div>
                )}
                {linked.lines.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {linked.lines
                      .map((l) => `${l.quantity} × ${l.product_snapshot?.name ?? l.notes ?? "linje"}`)
                      .join(" · ")}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => navigate(`/ordre/${linked.order!.id}`)}
                >
                  Åpne ordren →
                </Button>
                {ai?.change_intent && id && (
                  <ChangeIntentCard
                    ticketId={id}
                    orderId={linked.order.id}
                    orderNumber={linked.order.order_number}
                    ai={ai}
                    onApplied={() => {
                      qc.invalidateQueries({ queryKey: ["ticket-linked-order", linked.order!.id] });
                      qc.invalidateQueries({ queryKey: ["ticket-events", id] });
                      qc.invalidateQueries({ queryKey: ["ticket", id] });
                    }}
                  />
                )}
              </div>
            </SideCard>
          ) : (
            id && (
              <SideCard label="Koble til ordre">
                <LinkOrderSearch
                  ticketId={id}
                  onLinked={() => {
                    qc.invalidateQueries({ queryKey: ["ticket", id] });
                    qc.invalidateQueries({ queryKey: ["ticket-events", id] });
                  }}
                />
              </SideCard>
            )
          )}

          {id && <CakeImageStatusCard ticketId={id} />}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-6 top-6 rounded-full bg-background/20 p-2 text-white hover:bg-background/40"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.name}
            className="max-h-full max-w-full rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ────────────────────────── thread items

function IncomingEmail({
  ticket,
  attachments,
  onOpen,
}: {
  ticket: NonNullable<ReturnType<typeof useTicket>["data"]>["ticket"];
  attachments: TicketAttachment[];
  onOpen: (x: { url: string; name: string }) => void;
}) {
  if (!ticket) return null;
  const html = ticket.body_html ? sanitize(ticket.body_html) : null;
  return (
    <div className="rounded-lg border border-l-4 border-l-blue-500 bg-[hsl(var(--brand-cream))] p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-xs font-semibold text-blue-700 dark:text-blue-300">
          {initials(ticket.sender_name, ticket.sender_email)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">
            {ticket.sender_name ?? ticket.sender_email}
            <span className="ml-1 font-normal text-muted-foreground">
              · {ticket.sender_email}
            </span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {fmtTime(ticket.received_at)}
        </div>
      </div>
      {html ? (
        <div
          className="prose prose-sm max-w-none text-sm text-foreground [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {ticket.body_text ?? ticket.body_preview ?? ""}
        </p>
      )}
      {attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          {attachments.map((a) => (
            <AttachmentThumb
              key={a.id}
              att={a}
              onOpen={(url, name) => onOpen({ url, name })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyBubble({
  r,
}: {
  r: {
    id: string;
    body_text: string;
    sent_by_name: string | null;
    send_status: "pending" | "sent" | "failed";
    created_at: string;
    sent_at: string | null;
  };
}) {
  return (
    <div className="rounded-lg border border-l-4 border-l-emerald-500 bg-[hsl(var(--brand-cream))] p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <span className="font-semibold text-foreground">
          Svar sendt · {r.sent_by_name ?? "Bruker"}
        </span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
            r.send_status === "sent"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : r.send_status === "pending"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
          )}
        >
          {r.send_status}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtTime(r.sent_at ?? r.created_at)}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{r.body_text}</p>
    </div>
  );
}

function InternalNoteBubble({
  c,
}: {
  c: { id: string; body: string; author_name: string | null; created_at: string };
}) {
  return (
    <div className="rounded-lg border border-l-4 border-l-amber-400 bg-amber-50/60 p-4 shadow-sm dark:bg-amber-950/20">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <span className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
          Internt notat
        </span>
        <span className="font-semibold text-foreground">{c.author_name ?? "Bruker"}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtTime(c.created_at)}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
    </div>
  );
}

function EventBubble({ e }: { e: TicketEvent }) {
  const isForward = e.event_type === "ticket.forwarded_external";
  if (isForward) {
    return (
      <div className="rounded-lg border border-l-4 border-l-purple-500 bg-purple-50/60 p-3 text-sm shadow-sm dark:bg-purple-950/20">
        <div className="flex items-center gap-2 font-semibold text-purple-900 dark:text-purple-200">
          ✉️ Videresendt til {e.actor_label ?? "ekstern"}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {formatDistanceToNow(new Date(e.occurred_at), { locale: nb, addSuffix: true })}
          </span>
        </div>
        {e.summary && (
          <div className="mt-1 text-xs text-muted-foreground">{e.summary}</div>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border-l-2 border-l-muted-foreground/30 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{e.event_type}</span>
      {e.summary && <span>· {e.summary}</span>}
      {e.actor_label && <span>· {e.actor_label}</span>}
      <span className="ml-auto">
        {formatDistanceToNow(new Date(e.occurred_at), { locale: nb, addSuffix: true })}
      </span>
    </div>
  );
}

function InboundMessageBubble({ m }: { m: InboundMessage }) {
  const html = m.body_html ? sanitize(m.body_html) : null;
  return (
    <div className="rounded-lg border border-l-4 border-l-blue-500 bg-[hsl(var(--brand-cream))] p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-xs font-semibold text-blue-700 dark:text-blue-300">
          {initials(m.sender_name, m.sender_email)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">
            {m.sender_name ?? m.sender_email}
            <span className="ml-1 font-normal text-muted-foreground">· {m.sender_email}</span>
            {m.is_from_external_forward && (
              <span className="ml-2 inline-flex items-center rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
                svar fra ekstern
              </span>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">{fmtTime(m.received_at)}</div>
      </div>
      {html ? (
        <div
          className="prose prose-sm max-w-none text-sm text-foreground [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {m.body_text ?? m.body_preview ?? ""}
        </p>
      )}
    </div>
  );
}
