// Aggregert tidslinje for en ticket og/eller ordre.
// Kombinerer ticket_events + ticket_replies + order_status_history + order_confirmations_sent
// + syntetiske hendelser ("ticket mottatt", "AI fullført" osv. fra tickets-tabellen).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  EVENT_LABEL, type ActorType, type TicketEventType,
} from "@/ordre/lib/ticketEvents";

export type TimelineItem = {
  id: string;
  occurred_at: string;
  event_type: TicketEventType | string;
  label: string;
  summary?: string | null;
  actor_type: ActorType;
  actor_label?: string | null;
  payload?: Record<string, unknown>;
  source: "ticket_event" | "reply" | "status_history" | "confirmation" | "synthetic";
};

type Args = { ticketId?: string | null; orderId?: string | null };

export function useTicketTimeline({ ticketId, orderId }: Args) {
  const enabled = !!(ticketId || orderId);
  return useQuery({
    enabled,
    queryKey: ["ticket-timeline", ticketId ?? null, orderId ?? null],
    queryFn: async () => {
      const items: TimelineItem[] = [];

      // --- 1. ticket_events ---
      let eventsQ = supabase
        .from("ticket_events")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (ticketId && orderId) {
        eventsQ = eventsQ.or(`ticket_id.eq.${ticketId},order_id.eq.${orderId}`);
      } else if (ticketId) {
        eventsQ = eventsQ.eq("ticket_id", ticketId);
      } else if (orderId) {
        eventsQ = eventsQ.eq("order_id", orderId);
      }
      const { data: events } = await eventsQ;
      for (const e of (events ?? []) as Array<{
        id: string; occurred_at: string; event_type: string;
        actor_type: ActorType; actor_label: string | null;
        summary: string | null; payload: Record<string, unknown> | null;
      }>) {
        items.push({
          id: `evt-${e.id}`,
          occurred_at: e.occurred_at,
          event_type: e.event_type,
          label: (EVENT_LABEL as Record<string, string>)[e.event_type] ?? e.event_type,
          summary: e.summary,
          actor_type: e.actor_type,
          actor_label: e.actor_label,
          payload: e.payload ?? {},
          source: "ticket_event",
        });
      }

      // --- 2. ticket_replies (utgående svar) ---
      if (ticketId) {
        const { data: replies } = await supabase
          .from("ticket_replies")
          .select("id, sent_at, created_at, send_status, sent_by, body_text")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: false })
          .limit(100);
        for (const r of (replies ?? []) as Array<{
          id: string; sent_at: string | null; created_at: string;
          send_status: string | null; sent_by: string | null; body_text: string | null;
        }>) {
          const when = r.sent_at ?? r.created_at;
          const isFailed = r.send_status && !["sent", "queued", "pending"].includes(r.send_status);
          items.push({
            id: `rep-${r.id}`,
            occurred_at: when,
            event_type: "reply.sent",
            label: isFailed ? "Svar feilet" : "Svar sendt til kunde",
            summary: (r.body_text ?? "").slice(0, 180),
            actor_type: "staff",
            actor_label: null,
            payload: { send_status: r.send_status, sent_by: r.sent_by },
            source: "reply",
          });
        }
      }

      // --- 3. order_status_history ---
      if (orderId) {
        const { data: statuses } = await supabase
          .from("order_status_history")
          .select("id, changed_at, from_status, to_status, changed_by, notes")
          .eq("order_id", orderId)
          .order("changed_at", { ascending: false })
          .limit(100);
        for (const s of (statuses ?? []) as Array<{
          id: string; changed_at: string; from_status: string | null;
          to_status: string; changed_by: string | null; notes: string | null;
        }>) {
          items.push({
            id: `sts-${s.id}`,
            occurred_at: s.changed_at,
            event_type: "order.status_changed",
            label: "Ordrestatus endret",
            summary: `${s.from_status ?? "—"} → ${s.to_status}${s.notes ? ` · ${s.notes}` : ""}`,
            actor_type: s.changed_by ? "staff" : "system",
            actor_label: null,
            payload: { from: s.from_status, to: s.to_status },
            source: "status_history",
          });
        }
      }

      // --- 4. order_confirmations_sent ---
      if (orderId || ticketId) {
        let confQ = supabase
          .from("order_confirmations_sent")
          .select("id, created_at, recipient_email, subject, send_status, ticket_id, order_id")
          .order("created_at", { ascending: false })
          .limit(50);
        if (orderId && ticketId) {
          confQ = confQ.or(`order_id.eq.${orderId},ticket_id.eq.${ticketId}`);
        } else if (orderId) {
          confQ = confQ.eq("order_id", orderId);
        } else if (ticketId) {
          confQ = confQ.eq("ticket_id", ticketId);
        }
        const { data: confs } = await confQ;
        for (const c of (confs ?? []) as Array<{
          id: string; created_at: string; recipient_email: string;
          subject: string; send_status: string | null;
        }>) {
          const isFailed = c.send_status && !["sent", "queued", "pending"].includes(c.send_status);
          items.push({
            id: `cnf-${c.id}`,
            occurred_at: c.created_at,
            event_type: "confirmation.sent",
            label: isFailed ? "Bekreftelse feilet" : "Bekreftelse sendt",
            summary: `${c.subject} → ${c.recipient_email}`,
            actor_type: "staff",
            actor_label: null,
            payload: { send_status: c.send_status },
            source: "confirmation",
          });
        }
      }

      // --- 5. syntetiske hendelser fra tickets ---
      if (ticketId) {
        const { data: t } = await supabase
          .from("tickets")
          .select("id, received_at, ai_analyzed_at, ai_status, ai_provider, ai_model, related_order_id, status, sender_email, sender_name")
          .eq("id", ticketId)
          .maybeSingle();
        if (t) {
          items.push({
            id: `syn-recv-${t.id}`,
            occurred_at: t.received_at,
            event_type: "ticket.received",
            label: "Epost mottatt",
            summary: `${t.sender_name ?? t.sender_email} <${t.sender_email}>`,
            actor_type: "customer",
            actor_label: t.sender_email,
            payload: {},
            source: "synthetic",
          });
          if (t.ai_analyzed_at) {
            items.push({
              id: `syn-ai-${t.id}`,
              occurred_at: t.ai_analyzed_at,
              event_type: t.ai_status === "success" ? "ai.analysis_completed" : "ai.analysis_failed",
              label: t.ai_status === "success" ? "AI-analyse fullført" : "AI-analyse feilet",
              summary: t.ai_provider && t.ai_model ? `${t.ai_provider} · ${t.ai_model}` : null,
              actor_type: "ai",
              actor_label: t.ai_model ?? t.ai_provider ?? "AI",
              payload: {},
              source: "synthetic",
            });
          }
        }
      }

      // Sorter nyeste først
      items.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
      // Dedup på (event_type+occurred_at+summary) for å hindre dobbel-logg
      const seen = new Set<string>();
      const dedup: TimelineItem[] = [];
      for (const it of items) {
        const key = `${it.event_type}|${it.occurred_at}|${(it.summary ?? "").slice(0, 60)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(it);
      }
      return dedup;
    },
    staleTime: 15_000,
  });
}
