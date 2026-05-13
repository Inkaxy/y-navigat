import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TicketReply {
  id: string;
  ticket_id: string;
  body_text: string;
  body_rendered: string | null;
  sent_by: string;
  sent_by_name: string | null;
  microsoft_message_id: string | null;
  send_status: "pending" | "sent" | "failed";
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

export function useTicketReplies(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ["ticket-replies", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_replies")
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Omit<TicketReply, "sent_by_name">[];
      const userIds = Array.from(new Set(rows.map((r) => r.sent_by)));
      let nameMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: users } = await supabase
          .from("users_public")
          .select("id, display_name")
          .in("id", userIds);
        nameMap = Object.fromEntries(
          (users ?? []).map((u) => [u.id, u.display_name ?? "Bruker"]),
        );
      }
      return rows.map((r) => ({ ...r, sent_by_name: nameMap[r.sent_by] ?? null }));
    },
  });
}

export function useSendTicketReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticket_id, body_text }: { ticket_id: string; body_text: string }) => {
      const { data, error } = await supabase.functions.invoke("microsoft-graph-reply", {
        body: { ticket_id, body_text },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ticket-replies", vars.ticket_id] });
      qc.invalidateQueries({ queryKey: ["ticket", vars.ticket_id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tickets-counts"] });
    },
  });
}

export function useOrdrekontorAssignees() {
  return useQuery({
    queryKey: ["ordrekontor-assignees"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ordrekontor_assignees");
      if (error) throw error;
      return ((data ?? []) as { id: string; display_name: string }[])
        .sort((a, b) => a.display_name.localeCompare(b.display_name, "nb"));
    },
    staleTime: 5 * 60 * 1000,
  });
}
