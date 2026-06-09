import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { useKioskAuth } from "@/kiosk/context/KioskAuthContext";

export interface KioskTerminal {
  id: string;
  terminal_code: string;
  display_name: string;
  legal_entity_id: string;
  default_price_list_id: string | null;
  logo_url: string | null;
  customer_screen_mode: "logo_only" | "logo_and_cart";
}

type Status = "loading" | "ready" | "not_found" | "error";

interface State {
  status: Status;
  terminal: KioskTerminal | null;
  errorMessage?: string;
}

const Ctx = createContext<State>({ status: "loading", terminal: null });

export function TerminalProvider({
  terminalId,
  children,
}: {
  terminalId: string;
  children: ReactNode;
}) {
  const auth = useKioskAuth();
  const [state, setState] = useState<State>({ status: "loading", terminal: null });

  useEffect(() => {
    if (auth.status !== "ready") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await kioskSupabase
        .from("pos_terminals")
        .select("id, terminal_code, display_name, legal_entity_id, logo_url, customer_screen_mode")
        .eq("id", terminalId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState({ status: "error", terminal: null, errorMessage: error.message });
        return;
      }
      if (!data) {
        setState({ status: "not_found", terminal: null });
        return;
      }
      setState({ status: "ready", terminal: data as KioskTerminal });
    })();
    return () => {
      cancelled = true;
    };
  }, [terminalId, auth.status]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useTerminal() {
  return useContext(Ctx);
}
