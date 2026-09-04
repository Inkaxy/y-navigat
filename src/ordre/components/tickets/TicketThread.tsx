import { useMemo, useState } from "react";
import { ChevronDown, History, Lock, Mail, X } from "lucide-react";
import { cn } from "@/lib/utils";
import ConversationItem from "@/ordre/components/tickets/ConversationItem";
import TimelineEvent, {
  type TimelineEventRow,
} from "@/ordre/components/tickets/TimelineEvent";
import AttachmentThumb from "@/ordre/components/tickets/AttachmentThumb";
import EmailBody, {
  sanitizeEmailHtml,
  extractCidRefs,
} from "@/ordre/components/tickets/EmailBody";
import { sendStatusLabel } from "@/ordre/lib/ticketFormat";
import type { Ticket, TicketAttachment } from "@/ordre/hooks/useTickets";
import type { InboundMessage } from "@/ordre/hooks/useInboundMessages";
import type { TicketReply } from "@/ordre/hooks/useTicketReplies";
import type { InternalComment } from "@/ordre/hooks/useInternalComments";

export type TicketThreadProps = {
  ticket: Ticket;
  attachments: TicketAttachment[];
  inboundMessages: InboundMessage[];
  replies: TicketReply[];
  comments: InternalComment[];
  events: TimelineEventRow[];
  /** user_id → visningsnavn, for hendelsesaktører. */
  names?: Record<string, string>;
  linkedOrder?: {
    id: string;
    order_number: string;
    delivery_date: string | null;
  } | null;
  /** Peek-panelet er smalt — mindre marger og ingen utskriftsknapper. */
  compact?: boolean;
  className?: string;
};

/**
 * Tråden på en henvendelse, med tre tydelig atskilte lag:
 *
 * 1. Samtale mellom kunde og Nøtterø Bakeri (kronologisk)
 * 2. Interne notater — alltid merket «Kun synlig internt»
 * 3. Systemhistorikk — kollapset, fordi revisjonsloggen ikke er samtale
 */
export default function TicketThread({
  ticket,
  attachments,
  inboundMessages,
  replies,
  comments,
  events,
  names = {},
  linkedOrder,
  compact,
  className,
}: TicketThreadProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  /**
   * Vedlegg plasseres under meldingen de hører til: eksplisitt kobling fra
   * webhooken først, deretter cid-referanser, til slutt første e-post.
   */
  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, TicketAttachment[]>();
    const claimed = new Set<string>();
    for (const m of inboundMessages) {
      const explicit = attachments.filter((a) => a.ticket_inbound_message_id === m.id);
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
    map.set(
      "__root__",
      attachments.filter((a) => !claimed.has(a.id)),
    );
    return map;
  }, [attachments, inboundMessages]);

  const renderAttachments = (list: TicketAttachment[], authorName: string | null) => {
    const visible = list.filter((a) => !a.is_inline || !a.content_id);
    if (visible.length === 0) return undefined;
    return (
      <div className="flex flex-wrap gap-2">
        {visible.map((a) => (
          <AttachmentThumb
            key={a.id}
            att={a}
            onOpen={(url, name) => setLightbox({ url, name })}
            ticketId={ticket.id}
            ticketSubject={ticket.subject}
            order={linkedOrder ?? null}
            customerName={authorName}
            compact={compact}
          />
        ))}
      </div>
    );
  };

  type Item = { at: string; key: string; node: React.ReactNode };

  const conversation: Item[] = useMemo(() => {
    const out: Item[] = [];

    out.push({
      at: ticket.received_at,
      key: `root-${ticket.id}`,
      node: (
        <ConversationItem
          variant="incoming"
          authorName={ticket.sender_name || ticket.sender_email}
          roleLabel="Kunde"
          subLabel={ticket.sender_email}
          at={ticket.received_at}
          footer={renderAttachments(
            attachmentsByMessage.get("__root__") ?? [],
            ticket.sender_name ?? ticket.sender_email,
          )}
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
      out.push({
        at: m.received_at,
        key: `in-${m.id}`,
        node: (
          <ConversationItem
            variant={m.is_from_external_forward ? "external" : "incoming"}
            authorName={m.sender_name || m.sender_email}
            roleLabel={m.is_from_external_forward ? "Ekstern" : "Kunde"}
            subLabel={m.sender_email}
            at={m.received_at}
            footer={renderAttachments(
              attachmentsByMessage.get(m.id) ?? [],
              m.sender_name ?? m.sender_email,
            )}
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
                  "rounded border px-1.5 py-0.5 text-caption font-semibold uppercase tracking-wide",
                  r.send_status === "failed"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border bg-background text-muted-foreground",
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
        key: `note-${c.id}`,
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

    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [
    ticket,
    attachments,
    attachmentsByMessage,
    inboundMessages,
    replies,
    comments,
    compact,
    linkedOrder,
  ]);

  const noteCount = comments.length;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide text-foreground">
          <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Samtale
        </span>
        {noteCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3" aria-hidden="true" /> {noteCount} internt notat
            {noteCount === 1 ? "" : "er"}
          </span>
        )}
      </div>

      {conversation.map((it) => (
        <div key={it.key}>{it.node}</div>
      ))}

      <div className="rounded-[10px] border border-border bg-card">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-expanded={historyOpen}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-caption font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="inline-flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" aria-hidden="true" /> Systemhistorikk (
            {events.length})
          </span>
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", historyOpen && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {historyOpen && (
          <div className="border-t border-border px-1 py-1.5">
            {events.length === 0 ? (
              <p className="px-2 py-1 text-caption text-muted-foreground">
                Ingen hendelser er logget ennå.
              </p>
            ) : (
              events.map((e) => (
                <TimelineEvent
                  key={e.id}
                  event={e}
                  actorName={e.actor_user_id ? names[e.actor_user_id] : null}
                />
              ))
            )}
          </div>
        )}
      </div>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.name}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") setLightbox(null);
          }}
          ref={(el) => el?.focus()}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-8"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-6 top-6 rounded-full bg-background/20 p-2 text-background hover:bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setLightbox(null)}
            aria-label="Lukk bildevisning"
          >
            <X className="h-5 w-5" aria-hidden="true" />
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
