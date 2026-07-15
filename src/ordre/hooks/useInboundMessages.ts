import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface InboundMessage {
  id: string;
  ticket_id: string;
  sender_email: string;
  sender_name: string | null;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  body_preview: string | null;
  has_attachments: boolean;
  received_at: string;
  is_from_external_forward: boolean;
  created_at: string;
}

export function useInboundMessages(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ["ticket-inbound-messages", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_inbound_messages")
        .select(
          "id, ticket_id, sender_email, sender_name, subject, body_html, body_text, body_preview, has_attachments, received_at, is_from_external_forward, created_at",
        )
        .eq("ticket_id", ticketId!)
        .order("received_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InboundMessage[];
    },
  });
}
