import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Ticket } from "@/ordre/hooks/useTickets";

export type OrderConversation = Ticket & {
  message_count: number;
  last_activity_at: string;
};

/** Fetch tickets linked to this order via related_order_id OR ticket_order_links. */
export function useOrderConversations(orderId: string | null | undefined) {
  return useQuery({
    enabled: !!orderId,
    queryKey: ["order-conversations", orderId],
    queryFn: async (): Promise<OrderConversation[]> => {
      if (!orderId) return [];

      // 1. Ticket IDs koblet via link-tabellen
      const { data: links } = await supabase
        .from("ticket_order_links")
        .select("ticket_id")
        .eq("order_id", orderId);
      const linkedIds = (links ?? []).map((l) => l.ticket_id as string);

      // 2. Tickets med related_order_id ELLER i lenkede IDer
      const ors: string[] = [`related_order_id.eq.${orderId}`];
      if (linkedIds.length) {
        ors.push(`id.in.(${linkedIds.join(",")})`);
      }
      const { data: tickets, error } = await supabase
        .from("tickets")
        .select("*")
        .or(ors.join(","))
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const rows = (tickets ?? []) as unknown as Ticket[];
      if (!rows.length) return [];

      // 3. Meldingstellinger (svar) per ticket
      const ticketIds = rows.map((t) => t.id);
      const { data: replies } = await supabase
        .from("ticket_replies")
        .select("ticket_id, sent_at, created_at")
        .in("ticket_id", ticketIds);

      const replyCount = new Map<string, number>();
      const lastReplyAt = new Map<string, string>();
      for (const r of (replies ?? []) as Array<{
        ticket_id: string;
        sent_at: string | null;
        created_at: string;
      }>) {
        replyCount.set(r.ticket_id, (replyCount.get(r.ticket_id) ?? 0) + 1);
        const when = r.sent_at ?? r.created_at;
        const prev = lastReplyAt.get(r.ticket_id);
        if (!prev || when > prev) lastReplyAt.set(r.ticket_id, when);
      }

      return rows.map((t) => {
        const rc = replyCount.get(t.id) ?? 0;
        const lr = lastReplyAt.get(t.id);
        const last = [t.updated_at, t.received_at, lr].filter(Boolean).sort().pop()!;
        return {
          ...t,
          message_count: 1 + rc,
          last_activity_at: last,
        };
      });
    },
    staleTime: 15_000,
  });
}

/** Aggregate conversation counts for a set of orders (used in list views). */
export function useOrderConversationCounts(orderIds: string[]) {
  const key = [...orderIds].sort().join(",");
  return useQuery({
    enabled: orderIds.length > 0,
    queryKey: ["order-conversation-counts", key],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!orderIds.length) return {};

      const counts = new Map<string, Set<string>>();
      for (const id of orderIds) counts.set(id, new Set());

      const [{ data: linked }, { data: related }] = await Promise.all([
        supabase
          .from("ticket_order_links")
          .select("order_id, ticket_id")
          .in("order_id", orderIds),
        supabase
          .from("tickets")
          .select("id, related_order_id")
          .in("related_order_id", orderIds),
      ]);

      for (const l of (linked ?? []) as Array<{ order_id: string; ticket_id: string }>) {
        counts.get(l.order_id)?.add(l.ticket_id);
      }
      for (const t of (related ?? []) as Array<{ id: string; related_order_id: string | null }>) {
        if (t.related_order_id) counts.get(t.related_order_id)?.add(t.id);
      }

      const out: Record<string, number> = {};
      for (const [id, set] of counts) out[id] = set.size;
      return out;
    },
    staleTime: 30_000,
  });
}
