import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface PresenceUser {
  user_id: string;
  display_name: string;
  joined_at: string;
}

/**
 * Realtime presence for a single ticket. Returns *other* users currently
 * viewing the same ticket (excluding the current user).
 */
export function useTicketPresence(ticketId: string | undefined) {
  const { user } = useAuth();
  const [others, setOthers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!ticketId || !user?.id) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      // Hent display_name (best-effort)
      const { data: profile } = await supabase
        .from("users_public")
        .select("display_name, first_name")
        .eq("id", user.id)
        .maybeSingle();
      const displayName =
        profile?.display_name ??
        profile?.first_name ??
        user.email ??
        "Ukjent bruker";

      if (cancelled) return;

      channel = supabase.channel(`ticket-presence:${ticketId}`, {
        config: { presence: { key: user.id } },
      });

      const sync = () => {
        if (!channel) return;
        const state = channel.presenceState() as Record<string, PresenceUser[]>;
        const list: PresenceUser[] = [];
        for (const [key, metas] of Object.entries(state)) {
          if (key === user.id) continue;
          const m = metas[0];
          if (m) list.push(m);
        }
        setOthers(list);
      };

      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED" && channel) {
            await channel.track({
              user_id: user.id,
              display_name: displayName,
              joined_at: new Date().toISOString(),
            });
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) {
        channel.untrack().catch(() => {});
        supabase.removeChannel(channel);
      }
      setOthers([]);
    };
  }, [ticketId, user?.id, user?.email]);

  return others;
}
