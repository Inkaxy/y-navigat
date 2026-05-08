import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { APP_CODE, NB_LEGAL_ENTITY_ID } from "@/varer/lib/constants";
import { useSelection } from "@/providers/SelectionProvider";
import { setAppThemeFromHex } from "@/varer/lib/theme";

export type AccessLevel = "none" | "read" | "write" | "approve" | "admin";

interface AppInfo {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  theme_primary_color: string | null;
}

interface AppContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  app: AppInfo | null;
  appMissing: boolean;
  hasPositionInNb: boolean;
  accessLevel: AccessLevel;
  canWrite: boolean;
  canRead: boolean;
  /** Aktivt valgt selskap fra Shell. `null` hvis ingen er valgt. */
  legalEntityId: string | null;
  hasLegalEntity: boolean;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const { legalEntityId } = useSelection();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // App-rad fra apps-tabellen
  const appQuery = useQuery({
    queryKey: ["app", APP_CODE],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("apps")
        .select("id, code, display_name, description, icon, theme_primary_color")
        .eq("code", APP_CODE)
        .maybeSingle();
      if (error) throw error;
      return data as AppInfo | null;
    },
  });

  // Sett tema fra apps.theme_primary_color
  useEffect(() => {
    const hex = appQuery.data?.theme_primary_color;
    if (hex) setAppThemeFromHex(hex);
  }, [appQuery.data?.theme_primary_color]);

  // Aktive posisjoner for innlogget bruker — sjekk om noen ligger i NB
  const positionsQuery = useQuery({
    queryKey: ["my-positions", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("user_positions")
        .select("legal_entity_id, valid_from, valid_to")
        .eq("user_id", session!.user.id)
        .lte("valid_from", today);
      if (error) throw error;
      return (data ?? []).filter(
        (p) => p.valid_to === null || p.valid_to >= today,
      );
    },
  });

  const hasPositionInNb = !!positionsQuery.data?.some(
    (p) => p.legal_entity_id === NB_LEGAL_ENTITY_ID,
  );

  // Access-level på 'varer'-appen via RPC
  const accessQuery = useQuery({
    queryKey: ["app-access-level", APP_CODE, session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_access_level", {
        p_app_code: APP_CODE,
      });
      if (error) throw error;
      return (data as AccessLevel) ?? "none";
    },
  });

  const accessLevel: AccessLevel = accessQuery.data ?? "none";
  const canWrite = ["write", "approve", "admin"].includes(accessLevel);
  const canRead = accessLevel !== "none";

  const loading =
    authLoading ||
    appQuery.isLoading ||
    (!!session && (positionsQuery.isLoading || accessQuery.isLoading));

  return (
    <AppContext.Provider
      value={{
        loading,
        session,
        user: session?.user ?? null,
        app: appQuery.data ?? null,
        appMissing: !appQuery.isLoading && !appQuery.data,
        hasPositionInNb,
        accessLevel,
        canWrite,
        canRead,
        legalEntityId,
        hasLegalEntity: !!legalEntityId,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
