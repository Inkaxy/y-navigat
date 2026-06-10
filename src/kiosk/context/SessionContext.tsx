import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { useOperator } from "@/kiosk/context/OperatorContext";

export interface PosSession {
  id: string;
  terminal_id: string;
  operator_id: string;
  status: string;
  opening_float: number;
  opened_at: string;
}

type Status = "loading" | "no_session" | "open" | "error";

interface State {
  status: Status;
  session: PosSession | null;
  errorMessage?: string;
  openSession: (openingFloat: number) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<State | null>(null);

export function SessionProvider({
  terminalId,
  children,
}: {
  terminalId: string;
  children: ReactNode;
}) {
  const { operator } = useOperator();
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<PosSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    if (!operator) {
      setStatus("no_session");
      setSession(null);
      return;
    }
    setStatus("loading");
    // Én åpen sesjon per terminal — ikke filtrer på operator_id, slik at
    // en pågående sesjon åpnet av en annen operatør blir overtatt korrekt
    // (i stedet for at vi prøver å åpne en ny og treffer SESSION_ALREADY_OPEN).
    const { data, error } = await kioskSupabase
      .from("pos_sessions")
      .select("*")
      .eq("terminal_id", terminalId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1);
    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    if (data && data[0]) {
      setSession(data[0] as PosSession);
      setStatus("open");
    } else {
      setSession(null);
      setStatus("no_session");
    }
  }, [terminalId, operator]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openSession = useCallback<State["openSession"]>(
    async (openingFloat) => {
      if (!operator) return { ok: false, error: "Mangler operatør." };
      const { error } = await kioskSupabase.rpc("pos_open_session", {
        p_terminal_id: terminalId,
        p_operator_id: operator.id,
        p_opening_float: openingFloat,
      } as never);
      if (error) return { ok: false, error: error.message };
      await refresh();
      return { ok: true };
    },
    [terminalId, operator, refresh],
  );

  return (
    <Ctx.Provider
      value={{ status, session, errorMessage, openSession, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}
