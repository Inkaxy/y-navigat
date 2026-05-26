import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TicketTeam } from "@/ordre/lib/teams";

export interface InternalComment {
  id: string;
  ticket_id: string;
  body: string;
  mentioned_teams: TicketTeam[];
  author_id: string | null;
  author_name: string | null;
  created_at: string;
}

export function useInternalComments(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ["ticket-internal-comments", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_internal_comments")
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InternalComment[];
    },
  });
}

export function useAddInternalComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticket_id: string; body: string; mentioned_teams: TicketTeam[] }) => {
      const { data: u } = await supabase.auth.getUser();
      const user = u.user;
      if (!user) throw new Error("Ikke pålogget");
      let displayName: string | null = user.email ?? null;
      const { data: prof } = await supabase
        .from("users_public").select("display_name").eq("id", user.id).maybeSingle();
      if (prof?.display_name) displayName = prof.display_name;
      const { error } = await supabase.from("ticket_internal_comments").insert({
        ticket_id: input.ticket_id,
        body: input.body,
        mentioned_teams: input.mentioned_teams,
        author_id: user.id,
        author_name: displayName,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ticket-internal-comments", vars.ticket_id] });
      qc.invalidateQueries({ queryKey: ["my-unread-mentions"] });
    },
  });
}

export function useMyTeams() {
  return useQuery({
    queryKey: ["my-teams"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [] as TicketTeam[];
      const { data, error } = await supabase
        .from("user_team_memberships")
        .select("team")
        .eq("user_id", u.user.id);
      if (error) throw error;
      return ((data ?? []) as { team: TicketTeam }[]).map((r) => r.team);
    },
    staleTime: 5 * 60_000,
  });
}

export function useToggleMyTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ team, enabled }: { team: TicketTeam; enabled: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Ikke pålogget");
      if (enabled) {
        const { error } = await supabase
          .from("user_team_memberships")
          .upsert({ user_id: u.user.id, team } as never, { onConflict: "user_id,team" });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_team_memberships")
          .delete()
          .eq("user_id", u.user.id)
          .eq("team", team);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-teams"] });
      qc.invalidateQueries({ queryKey: ["my-unread-mentions"] });
    },
  });
}

// Liste over interne kommentarer som nevner et av mine teams og som jeg ikke har lest.
export function useMyUnreadMentions() {
  return useQuery({
    queryKey: ["my-unread-mentions"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const me = u.user;
      if (!me) return [] as Array<InternalComment & { read: boolean }>;
      const { data: teams } = await supabase
        .from("user_team_memberships").select("team").eq("user_id", me.id);
      const myTeams = ((teams ?? []) as { team: TicketTeam }[]).map((r) => r.team);
      if (myTeams.length === 0) return [];
      const { data: comments, error } = await supabase
        .from("ticket_internal_comments")
        .select("*")
        .overlaps("mentioned_teams", myTeams as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const ids = (comments ?? []).map((c) => c.id);
      let readIds = new Set<string>();
      if (ids.length > 0) {
        const { data: reads } = await supabase
          .from("ticket_internal_comment_reads")
          .select("comment_id")
          .eq("user_id", me.id)
          .in("comment_id", ids);
        readIds = new Set(((reads ?? []) as { comment_id: string }[]).map((r) => r.comment_id));
      }
      return ((comments ?? []) as InternalComment[])
        .filter((c) => c.author_id !== me.id)
        .map((c) => ({ ...c, read: readIds.has(c.id) }));
    },
    staleTime: 30_000,
  });
}

export function useMarkMentionsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (commentIds: string[]) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || commentIds.length === 0) return;
      const rows = commentIds.map((id) => ({ comment_id: id, user_id: u.user!.id }));
      const { error } = await supabase
        .from("ticket_internal_comment_reads")
        .upsert(rows as never, { onConflict: "comment_id,user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-unread-mentions"] });
    },
  });
}
