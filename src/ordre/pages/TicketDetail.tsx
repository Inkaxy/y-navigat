import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Link2,
  Loader2,
  Paperclip,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { TicketPresenceBanner } from "@/ordre/components/shell/TicketPresenceBanner";

import {
  useTicket,
  getTicketAttachmentSignedUrl,
  type TicketAttachment,
} from "@/ordre/hooks/useTickets";
import { useUserAccess } from "@/ordre/hooks/useUserAccess";
import { useTicketReplies } from "@/ordre/hooks/useTicketReplies";
import { useInternalComments } from "@/ordre/hooks/useInternalComments";
import { useInboundMessages, type InboundMessage } from "@/ordre/hooks/useInboundMessages";
import { useUserNames } from "@/ordre/hooks/useUserNames";
import { useSlaSettings } from "@/ordre/hooks/useSlaSettings";
import { computeDeadline, formatCountdown } from "@/ordre/lib/sla";
import {
  normalizeAiSuggestion,
  REQUEST_TYPE_LABEL,
  REQUEST_TYPE_BADGE,
} from "@/ordre/lib/aiSuggestion";
import {
  formatTicketTime,
  sendStatusLabel,
  ticketShortId,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_STYLE,
} from "@/ordre/lib/ticketFormat";
import { TEAM_LABEL } from "@/ordre/lib/teams";
import ConversationItem from "@/ordre/components/tickets/ConversationItem";
import TimelineEvent, {
  type TimelineEventRow,
} from "@/ordre/components/tickets/TimelineEvent";
import TicketActionBar from "@/ordre/components/tickets/TicketActionBar";
import TicketComposer from "@/ordre/components/tickets/TicketComposer";
import { useIsMobile } from "@/hooks/use-mobile";
import OrderLinkCard from "@/ordre/components/tickets/OrderLinkCard";
import EmailBody, { sanitizeEmailHtml, extractCidRefs } from "@/ordre/components/tickets/EmailBody";
import ChangeIntentCard from "@/ordre/components/tickets/ChangeIntentCard";
import AttachmentCakePrintButton from "@/ordre/components/tickets/AttachmentCakePrintButton";
import { CakeImageStatusCard } from "@/ordre/components/orders/CakeImageStatusCard";
import CreateRefundDialog from "@/ordre/components/tickets/CreateRefundDialog";
import QuickCreateCustomerDialog from "@/ordre/components/tickets/QuickCreateCustomerDialog";
import LinkCustomerDialog from "@/ordre/components/tickets/LinkCustomerDialog";
import RefundStatusCard from "@/ordre/components/tickets/RefundStatusCard";

// ────────────────────────── data hooks

function useTicketEvents(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ["ticket-events", ticketId],
    queryFn: async (): Promise<TimelineEventRow[]> => {
      const { data, error } = await supabase
        .from("ticket_events")
        .select("id, event_type, summary, actor_label, actor_user_id, occurred_at")
        .eq("ticket_id", ticketId!)
        .order("occurred_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TimelineEventRow[];
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
        .select("id, customer_number, display_name, primary_contact_email, primary_contact_phone")
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
          "id, order_number, status, delivery_date, delivery_time, customer_id, subtotal_excl_vat, total_incl_vat, legal_entity_id",
        )
        .eq("id", orderId!)
        .maybeSingle();
      if (error) throw error;
      const { data: lines } = await supabase
        .from("order_lines")
        .select("quantity, product_snapshot, notes")
        .eq("order_id", orderId!)
        .limit(6);
      let customerName: string | null = null;
      if (data?.customer_id) {
        const { data: c } = await supabase
          .from("customers")
          .select("display_name")
          .eq("id", data.customer_id)
          .maybeSingle();
        customerName = c?.display_name ?? null;
      }
      return {
        order: data,
        customerName,
        lines: (lines ?? []) as Array<{
          quantity: number;
          product_snapshot: { name?: string } | null;
          notes: string | null;
        }>,
      };
    },
  });
}

// ────────────────────────── attachment thumbnail

function AttachmentThumb({
  att,
  onOpen,
  ticketId,
  ticketSubject,
  order,
  customerName,
}: {
  att: TicketAttachment;
  onOpen: (url: string, name: string) => void;
  ticketId?: string;
  ticketSubject?: string | null;
  order?: { id: string; order_number: string; delivery_date: string | null } | null;
  customerName?: string | null;
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

  const ct = att.content_type ?? "";
  const isImage = ct.startsWith("image/");
  const isPdf = ct === "application/pdf" || /\.pdf$/i.test(att.file_name);

  const handleClick = () => {
    if (!url) return;
    if (isImage) onOpen(url, att.file_name);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background p-1.5">
      <button
        type="button"
        onClick={handleClick}
        className="group flex items-center gap-2 rounded px-0.5 py-0.5 text-left text-xs hover:bg-muted"
        title={isPdf ? "Åpne PDF i ny fane" : isImage ? "Åpne bilde" : "Åpne vedlegg"}
      >
        {isImage && url ? (
          <img src={url} alt={att.file_name} className="h-10 w-10 rounded object-cover" />
        ) : (
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded",
              isPdf ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground",
            )}
          >
            {isPdf ? <span className="text-[10px] font-bold">PDF</span> : <Paperclip className="h-4 w-4" />}
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
      {isImage && ticketId && (
        <AttachmentCakePrintButton
          att={att}
          ticketId={ticketId}
          ticketSubject={ticketSubject}
          order={order}
          customerName={customerName}
        />
      )}
    </div>
  );
}

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

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const canWrite = access?.hasOrdreWrite ?? false;
  const isMobile = useIsMobile();

  const { data: ticketData, isLoading } = useTicket(id);
  const ticket = ticketData?.ticket ?? null;
  const attachments = useMemo(() => ticketData?.attachments ?? [], [ticketData]);
  const { data: replies = [] } = useTicketReplies(id);
  const { data: comments = [] } = useInternalComments(id);
  const { data: events = [] } = useTicketEvents(id);
  const { data: inboundMessages = [] } = useInboundMessages(id);
  const { data: customerCard } = useCustomerCard(ticket?.sender_email);
  const { data: linked } = useLinkedOrder(ticket?.related_order_id ?? null);
  const { data: sla } = useSlaSettings();

  const [reanalyzing, setReanalyzing] = useState(false);
  const [showEvents, setShowEvents] = useState(true);
  const [refundOpen, setRefundOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [linkCustomerOpen, setLinkCustomerOpen] = useState(false);
  // Navn på aktører i hendelser + følgere + ansvarlig
  const nameIds = useMemo(
    () => [
      ...events.map((e) => e.actor_user_id ?? null),
      ...(ticket?.followers ?? []),
      ticket?.assigned_to ?? null,
    ],
    [events, ticket?.followers, ticket?.assigned_to],
  );
  const { data: names = {} } = useUserNames(nameIds);

  // Realtime
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
        {
          event: "*",
          schema: "public",
          table: "ticket_inbound_messages",
          filter: `ticket_id=eq.${id}`,
        },
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
  const intent = ai?.request_type ?? null;

  /**
   * Vedlegg plasseres under den meldingen de hører til: cid-referanser i
   * meldingens HTML avgjør eierskap; resten faller tilbake til første e-post.
   */
  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, TicketAttachment[]>();
    const claimed = new Set<string>();
    for (const m of inboundMessages) {
      // 1) Eksplisitt kobling fra webhooken — gjelder alle vedleggstyper.
      const explicit = attachments.filter((a) => a.ticket_inbound_message_id === m.id);
      // 2) Eldre rader uten kolonnen: fall tilbake til cid-referanser i HTML-en.
      const cids = extractCidRefs(m.body_html).map((c) => c.replace(/^<|>$/g, ""));
      const byCid = attachments.filter((a) => {
        if (a.ticket_inbound_message_id) return false;
        const cid = (a.content_id ?? "").replace(/^<|>$/g, "");
        return cid && cids.includes(cid);
      });
      const mine = [...explicit, ...byCid];
      for (const a of mine) claimed.add(a.id);
      map.set(m.id, mine);
    }
    map.set("__root__", attachments.filter((a) => !claimed.has(a.id)));
    return map;
  }, [attachments, inboundMessages]);

  const deadline = useMemo(
    () => (sla && ticket ? computeDeadline(ticket.received_at, intent, sla.sla, sla.bh) : null),
    [sla, intent, ticket],
  );
  const countdown = deadline ? formatCountdown(deadline, new Date()) : null;

  const awaitingCustomer = useMemo(() => {
    const lastOut = replies
      .filter((r) => r.send_status === "sent")
      .map((r) => r.sent_at ?? r.created_at)
      .sort()
      .pop();
    if (!lastOut || !ticket) return false;
    const lastIn = [ticket.received_at, ...inboundMessages.map((m) => m.received_at)]
      .sort()
      .pop()!;
    return new Date(lastOut).getTime() > new Date(lastIn).getTime();
  }, [replies, inboundMessages, ticket]);

  type Item = { at: string; key: string; node: React.ReactNode; isEvent: boolean };

  const items: Item[] = useMemo(() => {
    if (!ticket) return [];
    const out: Item[] = [];

    out.push({
      at: ticket.received_at,
      key: `root-${ticket.id}`,
      isEvent: false,
      node: (
        <ConversationItem
          variant="incoming"
          authorName={ticket.sender_name || ticket.sender_email}
          roleLabel="Kunde"
          subLabel={ticket.sender_email}
          at={ticket.received_at}
          footer={
            (attachmentsByMessage.get("__root__")?.filter((a) => !a.is_inline || !a.content_id)
              .length ?? 0) > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachmentsByMessage
                  .get("__root__")!
                  .filter((a) => !a.is_inline || !a.content_id)
                  .map((a) => (
                    <AttachmentThumb
                      key={a.id}
                      att={a}
                      onOpen={(url, name) => setLightbox({ url, name })}
                      ticketId={ticket.id}
                      ticketSubject={ticket.subject}
                      order={linked?.order ?? null}
                      customerName={ticket.sender_name ?? ticket.sender_email}
                    />
                  ))}
              </div>
            ) : undefined
          }
        >
          <EmailBody
            html={ticket.body_html ? sanitizeEmailHtml(ticket.body_html) : null}
            fallbackText={ticket.body_text ?? ticket.body_preview ?? ""}
            attachments={attachments}
            ticketId={ticket.id}
          />
        </ConversationItem>
      ),
    });

    for (const m of inboundMessages) {
      const own = attachmentsByMessage.get(m.id) ?? [];
      out.push({
        at: m.received_at,
        key: `in-${m.id}`,
        isEvent: false,
        node: (
          <ConversationItem
            variant={m.is_from_external_forward ? "external" : "incoming"}
            authorName={m.sender_name || m.sender_email}
            roleLabel={m.is_from_external_forward ? "Ekstern" : "Kunde"}
            subLabel={m.sender_email}
            at={m.received_at}
            footer={
              own.filter((a) => !a.is_inline || !a.content_id).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {own
                    .filter((a) => !a.is_inline || !a.content_id)
                    .map((a) => (
                      <AttachmentThumb
                        key={a.id}
                        att={a}
                        onOpen={(url, name) => setLightbox({ url, name })}
                        ticketId={ticket.id}
                        ticketSubject={ticket.subject}
                        order={linked?.order ?? null}
                        customerName={m.sender_name ?? m.sender_email}
                      />
                    ))}
                </div>
              ) : undefined
            }
          >
            <EmailBody
              html={m.body_html ? sanitizeEmailHtml(m.body_html) : null}
              fallbackText={m.body_text ?? m.body_preview ?? ""}
              attachments={attachments}
              ticketId={m.ticket_id}
            />
          </ConversationItem>
        ),
      });
    }

    for (const r of replies) {
      out.push({
        at: r.sent_at ?? r.created_at,
        key: `re-${r.id}`,
        isEvent: false,
        node: (
          <ConversationItem
            variant="outgoing"
            authorName={r.sent_by_name ?? "Ukjent bruker"}
            roleLabel="Nøtterø Bakeri"
            subLabel="Sendt til kunde"
            at={r.sent_at ?? r.created_at}
            statusChip={
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  r.send_status === "sent"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : r.send_status === "pending"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
                )}
              >
                {sendStatusLabel(r.send_status, r.error_message)}
              </span>
            }
          >
            <p className="whitespace-pre-wrap text-sm text-foreground">{r.body_text}</p>
          </ConversationItem>
        ),
      });
    }

    for (const c of comments) {
      out.push({
        at: c.created_at,
        key: `no-${c.id}`,
        isEvent: false,
        node: (
          <ConversationItem
            variant="note"
            authorName={c.author_name ?? "Ukjent bruker"}
            roleLabel="Internt notat"
            at={c.created_at}
          >
            <p className="whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
          </ConversationItem>
        ),
      });
    }

    for (const e of events) {
      out.push({
        at: e.occurred_at,
        key: `ev-${e.id}`,
        isEvent: true,
        node: (
          <TimelineEvent
            event={e}
            actorName={e.actor_user_id ? names[e.actor_user_id] : null}
          />
        ),
      });
    }

    out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return out;
  }, [
    ticket,
    attachments,
    attachmentsByMessage,
    inboundMessages,
    replies,
    comments,
    events,
    names,
    linked?.order,
  ]);

  if (isLoading || !ticket) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Laster henvendelse …
      </div>
    );
  }

  const visibleItems = showEvents ? items : items.filter((i) => !i.isEvent);

  // ─── handlers

  const onReanalyze = async () => {
    if (!id) return;
    setReanalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-email-with-ai", {
        body: { ticket_id: id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      toast.success("AI-analysen er oppdatert");
    } catch (e) {
      toast.error(`Analysen feilet: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReanalyzing(false);
    }
  };

  const actionBar = (
    <TicketActionBar
      ticket={ticket}
      canWrite={canWrite}
      linkedOrderNumber={linked?.order?.order_number ?? null}
    />
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
      {id && <TicketPresenceBanner ticketId={id} />}

      <Link
        to="/ordre/ticket"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Tilbake til innboksen
      </Link>

      {/* A) Topplinje */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b bg-[hsl(var(--background))]/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">
              {ticket.subject || "(uten emne)"}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Fra {ticket.sender_name ?? ticket.sender_email} &lt;{ticket.sender_email}&gt; · mottatt{" "}
              {formatTicketTime(ticket.received_at)} · {ticketShortId(ticket.id)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  TICKET_STATUS_STYLE[ticket.status],
                )}
              >
                {TICKET_STATUS_LABEL[ticket.status]}
              </span>
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
              {awaitingCustomer && (
                <span className="inline-flex items-center rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                  Venter på kunde
                </span>
              )}
              {ticket.awaiting_internal && (
                <span className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Venter på @
                  {ticket.assigned_team
                    ? TEAM_LABEL[ticket.assigned_team]
                    : names[ticket.assigned_to ?? ""] ?? "intern"}
                </span>
              )}
              {ticket.awaiting_external && (
                <span className="inline-flex items-center rounded border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
                  Venter på ekstern: {ticket.awaiting_external_email ?? "ukjent"}
                </span>
              )}
              {countdown?.overdue && (
                <span
                  className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300"
                  title={deadline ? `Frist: ${formatTicketTime(deadline)}` : undefined}
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Over frist ·{" "}
                  {deadline ? formatTicketTime(deadline) : ""}
                </span>
              )}
              {/* Uten AI-intensjon brukes standardfristen — vis hvorfor fristen finnes. */}
              {deadline && !intent && (
                <span
                  className="inline-flex items-center rounded border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title={`Frist: ${formatTicketTime(deadline)}`}
                >
                  (standardfrist)
                </span>
              )}

            </div>
          </div>

          {/* Handlingsrad — kollapser til knapp på mobil. Kun ÉN instans rendres. */}
          {isMobile ? (
            <details className="w-full">
              <summary className="cursor-pointer rounded-md border bg-background px-3 py-2 text-sm font-medium">
                Handlinger
              </summary>
              <div className="mt-2">{actionBar}</div>
            </details>
          ) : (
            <div>{actionBar}</div>
          )}
        </div>
        {!canWrite && (
          <p className="mt-2 text-xs text-muted-foreground">
            Du har lesetilgang til ordre-appen. Handlinger og svar er deaktivert.
          </p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* B) Samtalen */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2 rounded-md border bg-[hsl(var(--brand-cream))] px-3 py-2">
            <Switch
              id="show-events"
              checked={showEvents}
              onCheckedChange={setShowEvents}
            />
            <Label htmlFor="show-events" className="cursor-pointer text-sm">
              {showEvents ? "Vis systemhendelser" : "Kun samtale"}
            </Label>
          </div>

          {visibleItems.map((it) => (
            <div key={it.key}>{it.node}</div>
          ))}

          {/* C) Skrivefelt — samme komposer som i innboksen */}
          <TicketComposer
            ticket={ticket}
            canWrite={canWrite}
            onAfterSend={() => {
              qc.invalidateQueries({ queryKey: ["ticket", id] });
              qc.invalidateQueries({ queryKey: ["ticket-events", id] });
              qc.invalidateQueries({ queryKey: ["ticket-replies", id] });
              qc.invalidateQueries({ queryKey: ["ticket-internal-comments", id] });
            }}
          />
        </div>

        {/* D) Høyre kolonne */}
        <div className="space-y-3">
          <OrderLinkCard
            ticket={ticket}
            linked={linked}
            ai={ai}
            attachments={attachments}
            canWrite={canWrite}
          >
            {linked?.order && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full gap-2"
                  onClick={() => setRefundOpen(true)}
                  disabled={!canWrite}
                >
                  Opprett tilbakebetaling
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
              </>
            )}
          </OrderLinkCard>

          <SideCard label="Kunde">
            {customerCard?.customer ? (
              <div className="space-y-1 text-sm">
                <Link
                  to={`/kunder/kundeliste/${customerCard.customer.id}`}
                  className="font-semibold text-foreground underline-offset-2 hover:underline"
                >
                  {customerCard.customer.display_name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  Kundenr. {customerCard.customer.customer_number}
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
              <div className="space-y-2">
                <div className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Ikke i kunderegisteret
                </div>
                <div className="text-xs text-muted-foreground">
                  {ticket.sender_name ?? ticket.sender_email}
                </div>
                <div className="text-xs text-muted-foreground">{ticket.sender_email}</div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setCreateCustomerOpen(true)}>
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Opprett kunde
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLinkCustomerOpen(true)}>
                    <Link2 className="mr-1.5 h-3.5 w-3.5" /> Koble til eksisterende
                  </Button>
                </div>
              </div>
            )}

          </SideCard>

          <SideCard
            label="AI-analyse"
            right={
              ticket.ai_confidence_score != null ? (
                <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Konfidens{" "}
                  {Math.round(
                    Number(ticket.ai_confidence_score) *
                      (Number(ticket.ai_confidence_score) > 1 ? 1 : 100),
                  )}
                  %
                </span>
              ) : null
            }
          >
            <div className="space-y-2 text-sm">
              {intent ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase",
                    REQUEST_TYPE_BADGE[intent],
                  )}
                >
                  {REQUEST_TYPE_LABEL[intent]}
                </span>
              ) : (
                <p className="text-xs text-muted-foreground">Ingen analyse er kjørt ennå.</p>
              )}
              {ai?.summary && <p className="text-foreground">{ai.summary}</p>}
              {(ai?.missing_info?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Mangler info
                  </div>
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {ai!.missing_info.map((m) => (
                      <li key={m.code}>{m.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(ai?.risks?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  {ai!.risks.map((r, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded border px-2 py-1.5 text-xs",
                        r.severity === "red"
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
                      )}
                    >
                      {r.message}
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={onReanalyze}
                disabled={!canWrite || reanalyzing}
              >
                {reanalyzing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Kjør analyse på nytt
              </Button>
            </div>
          </SideCard>

          <SideCard label="Detaljer">
            <dl className="space-y-1 text-xs">
              <Detail label="Ansvarlig" value={names[ticket.assigned_to ?? ""] ?? "Uten ansvarlig"} />
              <Detail
                label="Team"
                value={ticket.assigned_team ? TEAM_LABEL[ticket.assigned_team] : "Uten team"}
              />
              <Detail label="Prioritet" value={TICKET_PRIORITY_LABEL[ticket.priority]} />
              <Detail
                label="Følgere"
                value={
                  (ticket.followers ?? []).length
                    ? ticket.followers.map((f) => names[f] ?? "Ukjent bruker").join(", ")
                    : "Ingen"
                }
              />
              <Detail label="Opprettet" value={formatTicketTime(ticket.created_at)} />
              <Detail label="Sist oppdatert" value={formatTicketTime(ticket.updated_at)} />
              <Detail label="Postboks" value={ticket.source_mailbox} />
            </dl>
          </SideCard>

          {id && <CakeImageStatusCard ticketId={id} />}
          {id && <RefundStatusCard ticketId={id} />}
        </div>
      </div>

      <QuickCreateCustomerDialog
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        defaultName={ticket.sender_name}
        defaultEmail={ticket.sender_email}
        onCreated={() =>
          qc.invalidateQueries({ queryKey: ["ticket-customer-card", ticket.sender_email] })
        }
      />
      <LinkCustomerDialog
        open={linkCustomerOpen}
        onOpenChange={setLinkCustomerOpen}
        senderEmail={ticket.sender_email}
        senderName={ticket.sender_name}
        onLinked={() =>
          qc.invalidateQueries({ queryKey: ["ticket-customer-card", ticket.sender_email] })
        }
      />

      {id && linked?.order && (
        <CreateRefundDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          ticketId={id}
          orderId={linked.order.id}
          legalEntityId={(linked.order as unknown as { legal_entity_id: string }).legal_entity_id}
          orderNumber={linked.order.order_number}
          suggestedAmount={
            (linked.order as unknown as { total_incl_vat?: number | null }).total_incl_vat ??
            linked.order.subtotal_excl_vat ??
            null
          }
          suggestedReason={ai?.summary ?? null}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["refunds", "ticket", id] });
          }}
        />
      )}

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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-foreground">{value}</dd>
    </div>
  );
}
