import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ensureKioskSession } from "@/kiosk/lib/auth";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";

type Status = "booting" | "ready" | "missing_env" | "auth_failed";

interface KioskAuthState {
  status: Status;
  errorMessage?: string;
}

const Ctx = createContext<KioskAuthState>({ status: "booting" });

export function KioskAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<KioskAuthState>({ status: "booting" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await ensureKioskSession();
      if (cancelled) return;
      if (result.ok) setState({ status: "ready" });
      else if (result.reason === "missing_env") setState({ status: "missing_env" });
      else setState({ status: "auth_failed", errorMessage: result.error });
    })();
    const { data: sub } = kioskSupabase.auth.onAuthStateChange((_evt, session) => {
      if (cancelled) return;
      if (!session) {
        // re-bootstrap if session disappears
        ensureKioskSession().then((r) => {
          if (cancelled) return;
          if (r.ok) setState({ status: "ready" });
        });
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useKioskAuth() {
  return useContext(Ctx);
}
