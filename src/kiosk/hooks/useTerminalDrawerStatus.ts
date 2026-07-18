import { useCallback, useEffect, useState } from "react";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";

export interface DrawerStatus {
  isOpen: boolean;
  reason: string | null;
  openedAt: string | null;
}

/**
 * Live-status for skuffen på en terminal. Kassasystemforskrifta: skuffen skal
 * være lukket mellom hvert salg. Vi speiler `pos_terminals.drawer_is_open` og
 * eksponerer en `closeDrawer()`-callback som operatøren bruker for å bekrefte
 * fysisk lukking.
 */
export function useTerminalDrawerStatus(
  terminalId: string | null | undefined,
  operatorId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  const [status, setStatus] = useState<DrawerStatus>({
    isOpen: false,
    reason: null,
    openedAt: null,
  });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!terminalId) return;
    const { data } = await kioskSupabase
      .from("pos_terminals")
      .select("drawer_is_open, drawer_opened_reason, drawer_opened_at")
      .eq("id", terminalId)
      .maybeSingle();
    if (data) {
      setStatus({
        isOpen: Boolean((data as { drawer_is_open?: boolean }).drawer_is_open),
        reason: (data as { drawer_opened_reason?: string | null }).drawer_opened_reason ?? null,
        openedAt: (data as { drawer_opened_at?: string | null }).drawer_opened_at ?? null,
      });
    }
  }, [terminalId]);

  useEffect(() => {
    if (!terminalId) return;
    void refresh();
    const ch = kioskSupabase
      .channel(`pos_terminal_drawer_${terminalId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pos_terminals",
          filter: `id=eq.${terminalId}`,
        },
        (payload) => {
          const n = payload.new as {
            drawer_is_open?: boolean;
            drawer_opened_reason?: string | null;
            drawer_opened_at?: string | null;
          };
          setStatus({
            isOpen: Boolean(n.drawer_is_open),
            reason: n.drawer_opened_reason ?? null,
            openedAt: n.drawer_opened_at ?? null,
          });
        },
      )
      .subscribe();
    return () => {
      kioskSupabase.removeChannel(ch);
    };
  }, [terminalId, refresh]);

  const openDrawer = useCallback(
    async (reason: string, context: string = "manual") => {
      if (!terminalId) throw new Error("Ingen terminal");
      setBusy(true);
      try {
        const { error } = await kioskSupabase.rpc("pos_open_drawer" as never, {
          p_terminal_id: terminalId,
          p_operator_id: operatorId ?? null,
          p_session_id: sessionId ?? null,
          p_reason: reason,
          p_context: context,
        } as never);
        if (error) throw error;
      } finally {
        setBusy(false);
      }
    },
    [terminalId, operatorId, sessionId],
  );

  const closeDrawer = useCallback(async () => {
    if (!terminalId) throw new Error("Ingen terminal");
    setBusy(true);
    try {
      const { error } = await kioskSupabase.rpc("pos_close_drawer" as never, {
        p_terminal_id: terminalId,
        p_operator_id: operatorId ?? null,
        p_session_id: sessionId ?? null,
      } as never);
      if (error) throw error;
    } finally {
      setBusy(false);
    }
  }, [terminalId, operatorId, sessionId]);

  return { status, busy, openDrawer, closeDrawer, refresh };
}
