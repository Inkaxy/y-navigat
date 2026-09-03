import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TicketStatus = "new" | "in_progress" | "resolved" | "closed" | "spam";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface Ticket {
  id: string;
  microsoft_message_id: string;
  source_mailbox: string;
  subject: string | null;
  /** Tunge felt hentes kun i detaljvisning (`useTicket`), ikke i lister. */
  body_html?: string | null;
  body_text?: string | null;
  body_preview: string | null;
  sender_email: string;
  sender_name: string | null;
  to_recipients: unknown;
  cc_recipients: unknown;
  has_attachments: boolean;
  received_at: string;
  importance: string | null;
  conversation_id: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  related_order_id: string | null;
  internal_notes: string | null;
  ai_status: string | null;
  ai_suggestion: unknown;
  ai_confidence_score: number | null;
  assigned_team: import("@/ordre/lib/teams").TicketTeam | null;
  awaiting_internal: boolean;
  awaiting_external: boolean;
  awaiting_external_email: string | null;
  followers: string[];
  created_at: string;
  updated_at: string;
}

export type AttachmentKind =
  | "inspiration"
  | "logo"
  | "document"
  | "other"
  | "cake_image"
  | "unclassified";

/** Ordrenummer for et sett ordre-id-er — brukes til å vise ordre i innboksene. */
export function useOrderNumbersByIds(orderIds: (string | null | undefined)[]) {
  const ids = Array.from(new Set(orderIds.filter(Boolean) as string[])).sort();
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["ticket-order-numbers", ids.join(",")],
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as { id: string; order_number: string }[]) {
        map[r.id] = r.order_number;
      }
      return map;
    },
  });
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  is_inline: boolean;
  kind: AttachmentKind;
  attached_to_order_id: string | null;
  ai_summary: string | null;
  ai_summarized_at: string | null;
  attached_by: string | null;
  attached_at: string | null;
  content_id: string | null;
  microsoft_attachment_id?: string | null;
}

export interface TicketsFilter {
  search?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  assigned?: "all" | "mine" | "unassigned" | string; // string = specific user_id
  fromDate?: string;
  toDate?: string;
}

/**
 * Kolonner som innboks-lister trenger. Tunge/sensitive felt (`body_html`,
 * `body_text`, `internal_notes`, `ai_suggestion`) hentes bevisst ikke her —
 * de lastes først i detaljvisningen via `useTicket`.
 */
export const TICKET_LIST_COLUMNS =
  "id, microsoft_message_id, source_mailbox, subject, body_preview, sender_email, sender_name, to_recipients, cc_recipients, has_attachments, received_at, importance, conversation_id, status, priority, assigned_to, assigned_team, related_order_id, ai_status, ai_confidence_score, awaiting_internal, awaiting_external, awaiting_external_email, followers, created_at, updated_at";

export function useTickets(filter: TicketsFilter = {}) {
  return useQuery({
    queryKey: ["tickets", filter],
    queryFn: async () => {
      let q = supabase
        .from("tickets")
        .select(TICKET_LIST_COLUMNS)
        .order("received_at", { ascending: false })
        .limit(500);
      if (filter.search) {
        const s = `%${filter.search}%`;
        q = q.or(`subject.ilike.${s},sender_email.ilike.${s},sender_name.ilike.${s},body_text.ilike.${s},body_preview.ilike.${s}`);
      }
      if (filter.status?.length) q = q.in("status", filter.status);
      if (filter.priority?.length) q = q.in("priority", filter.priority);
      if (filter.fromDate) q = q.gte("received_at", filter.fromDate);
      if (filter.toDate) q = q.lte("received_at", filter.toDate + "T23:59:59");
      if (filter.assigned === "mine") {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) q = q.eq("assigned_to", u.user.id);
      } else if (filter.assigned === "unassigned") {
        q = q.is("assigned_to", null);
      } else if (filter.assigned && filter.assigned !== "all") {
        q = q.eq("assigned_to", filter.assigned);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Ticket[];
    },
  });
}

// Hent siste utgående svar per ticket — brukes til å avgjøre "venter på kunde".
export function useLatestReplyByTicket(ticketIds: string[]) {
  const ids = [...ticketIds].sort();
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["tickets-latest-reply", ids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_replies")
        .select("ticket_id, sent_at, send_status")
        .in("ticket_id", ids)
        .eq("send_status", "sent")
        .order("sent_at", { ascending: false });
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data ?? []) as Array<{ ticket_id: string; sent_at: string | null }>) {
        if (!r.sent_at) continue;
        if (!map.has(r.ticket_id)) map.set(r.ticket_id, r.sent_at);
      }
      return map;
    },
    staleTime: 30_000,
  });
}

// Hent siste INNGÅENDE melding per ticket (utover selve opprinnelses-e-posten).
export function useLatestInboundByTicket(ticketIds: string[]) {
  const ids = [...ticketIds].sort();
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["tickets-latest-inbound", ids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_inbound_messages")
        .select("ticket_id, received_at")
        .in("ticket_id", ids)
        .order("received_at", { ascending: false });
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data ?? []) as Array<{ ticket_id: string; received_at: string | null }>) {
        if (!r.received_at) continue;
        if (!map.has(r.ticket_id)) map.set(r.ticket_id, r.received_at);
      }
      return map;
    },
    staleTime: 30_000,
  });
}

/**
 * «Venter på kunde» = siste utgående svar er nyere enn siste INNGÅENDE melding
 * (opprinnelig e-post eller senere kundesvar). `awaiting_internal` er intern
 * venting og skal IKKE brukes her.
 */
export function isAwaitingCustomer(args: {
  receivedAt: string;
  lastOutgoing: string | undefined;
  lastInbound: string | undefined;
}): boolean {
  if (!args.lastOutgoing) return false;
  const inbound = Math.max(
    new Date(args.receivedAt).getTime(),
    args.lastInbound ? new Date(args.lastInbound).getTime() : 0,
  );
  return new Date(args.lastOutgoing).getTime() > inbound;
}


export function useTicketCounts() {
  return useQuery({
    queryKey: ["tickets-counts"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const myId = u.user?.id;
      const [newRes, ipRes, mineRes, latest] = await Promise.all([
        supabase.from("tickets").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase.from("tickets").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
        myId
          ? supabase.from("tickets").select("id", { count: "exact", head: true }).eq("assigned_to", myId).in("status", ["new", "in_progress"])
          : Promise.resolve({ count: 0 } as any),
        supabase.from("tickets").select("id, subject, sender_email, sender_name, received_at").eq("status", "new").order("received_at", { ascending: false }).limit(5),
      ]);
      return {
        newCount: newRes.count ?? 0,
        inProgressCount: ipRes.count ?? 0,
        mineCount: mineRes.count ?? 0,
        latestNew: (latest.data ?? []) as Pick<Ticket, "id" | "subject" | "sender_email" | "sender_name" | "received_at">[],
      };
    },
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["ticket", id],
    queryFn: async () => {
      const { data: ticket, error } = await supabase.from("tickets").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      const { data: atts, error: aErr } = await supabase
        .from("ticket_attachments")
        .select("*")
        .eq("ticket_id", id!)
        .order("created_at");
      if (aErr) throw aErr;
      return { ticket: ticket as Ticket | null, attachments: (atts ?? []) as TicketAttachment[] };
    },
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Ticket> }) => {
      const { error } = await supabase.from("tickets").update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ticket", vars.id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tickets-counts"] });
    },
  });
}

export async function getTicketAttachmentSignedUrl(
  attachmentId: string,
  opts: { inline?: boolean } = {},
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ticket-attachment-signed-url", {
    body: { attachment_id: attachmentId, inline: !!opts.inline },
  });
  if (error) throw error;
  if (!data?.signed_url) throw new Error("Ingen URL returnert");
  return data.signed_url as string;
}

export function useUpdateAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<TicketAttachment, "kind" | "attached_to_order_id">> & {
        attached_by?: string | null;
        attached_at?: string | null;
      };
    }) => {
      const { error } = await supabase
        .from("ticket_attachments")
        .update(patch as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket"] });
      qc.invalidateQueries({ queryKey: ["order-attachments"] });
    },
  });
}

export function useOrderAttachments(orderId: string | undefined) {
  return useQuery({
    enabled: !!orderId,
    queryKey: ["order-attachments", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_attachments")
        .select("*")
        .eq("attached_to_order_id", orderId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as TicketAttachment[];
    },
  });
}

