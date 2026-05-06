import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { APP_CODE } from "@/fakturaer/lib/constants";

export type AccessLevel = "none" | "read" | "write" | "approve" | "admin";

interface FakturaerContextValue {
  loading: boolean;
  session: Session | null;
  accessLevel: AccessLevel;
  canRead: boolean;
  canWrite: boolean;
  canApprove: boolean;
  canAdmin: boolean;
}

const Ctx = createContext<FakturaerContextValue | undefined>(undefined);

export function FakturaerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const accessQuery = useQuery({
    queryKey: ["fakturaer-access-level", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_access_level", { p_app_code: APP_CODE });
      if (error) throw error;
      return (data as AccessLevel) ?? "none";
    },
  });

  const accessLevel: AccessLevel = accessQuery.data ?? "none";
  const canRead = accessLevel !== "none";
  const canWrite = ["write", "approve", "admin"].includes(accessLevel);
  const canApprove = ["approve", "admin"].includes(accessLevel);
  const canAdmin = accessLevel === "admin";

  const loading = authLoading || (!!session && accessQuery.isLoading);

  return (
    <Ctx.Provider value={{ loading, session, accessLevel, canRead, canWrite, canApprove, canAdmin }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFakturaer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFakturaer must be used within FakturaerProvider");
  return ctx;
}
