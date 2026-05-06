import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { APP_CODE, NB_LEGAL_ENTITY_ID } from "@/ravarer/lib/constants";

export type AccessLevel = "none" | "read" | "write" | "approve" | "admin";

interface RavarerContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  legalEntityId: string;
  accessLevel: AccessLevel;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

const Ctx = createContext<RavarerContextValue | undefined>(undefined);

export function RavarerProvider({ children }: { children: ReactNode }) {
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
    queryKey: ["ravarer-access-level", session?.user.id],
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
  const canDelete = accessLevel === "admin";

  const loading = authLoading || (!!session && accessQuery.isLoading);

  return (
    <Ctx.Provider
      value={{
        loading,
        session,
        user: session?.user ?? null,
        legalEntityId: NB_LEGAL_ENTITY_ID,
        accessLevel,
        canRead,
        canWrite,
        canDelete,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useRavarer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRavarer must be used within RavarerProvider");
  return ctx;
}
