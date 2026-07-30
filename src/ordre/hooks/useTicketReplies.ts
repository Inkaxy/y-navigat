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

/**
 * Sender svar til kunde via Microsoft Graph, logger svaret i ticket_replies og
 * setter ticket til «venter på kunde». All sending går gjennom denne
 * mutasjonen, slik at `isPending` faktisk kan deaktivere Send-knappen og
 * hindre dobbeltsending ved raske dobbeltklikk.
 */
export function useSendTicketReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ticket_id,
      body_text,
    }: {
      ticket_id: string;
      body_text: string;
    }) => {
      const text = body_text.trim();
      if (!text) throw new Error("Tomt svar");
      const html = text
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
        .join("");
      // Idempotens-nøkkel: hindrer duplikate rader dersom to kall slipper gjennom.
      const idempotencyKey = crypto.randomUUID();

      const { data, error } = await supabase.functions.invoke(
        "microsoft-graph-reply-ticket",
        { body: { ticket_id, body_html: html, idempotency_key: idempotencyKey } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: u } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from("ticket_replies").insert({
        ticket_id,
        body_text: text,
        body_rendered: html,
        sent_by: u.user?.id ?? "",
        send_status: "sent",
        sent_at: new Date().toISOString(),
        idempotency_key: idempotencyKey,
      } as never);
      // Unik-konflikt = allerede logget; ikke en reell feil.
      if (insErr && insErr.code !== "23505") throw insErr;

      const { error: updErr } = await supabase
        .from("tickets")
        .update({ status: "in_progress", awaiting_internal: false } as never)
        .eq("id", ticket_id);
      if (updErr) throw updErr;

      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ticket-replies", vars.ticket_id] });
      qc.invalidateQueries({ queryKey: ["ticket", vars.ticket_id] });
      qc.invalidateQueries({ queryKey: ["ticket-events", vars.ticket_id] });
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
