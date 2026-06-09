import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { KIOSK_REALTIME_CHANNEL } from "@/kiosk/lib/routes";

interface State {
  channel: RealtimeChannel;
}

const Ctx = createContext<State | null>(null);

export function RealtimeProvider({
  terminalId,
  children,
}: {
  terminalId: string;
  children: ReactNode;
}) {
  const channel = useMemo(
    () =>
      kioskSupabase.channel(KIOSK_REALTIME_CHANNEL(terminalId), {
        config: { broadcast: { ack: false, self: false } },
      }),
    [terminalId],
  );

  useEffect(() => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // eslint-disable-next-line no-console
        console.info(`[kiosk] realtime subscribed: ${KIOSK_REALTIME_CHANNEL(terminalId)}`);
      }
    });
    return () => {
      kioskSupabase.removeChannel(channel);
    };
  }, [channel, terminalId]);

  return <Ctx.Provider value={{ channel }}>{children}</Ctx.Provider>;
}

export function useKioskChannel() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useKioskChannel must be used inside RealtimeProvider");
  return v.channel;
}
