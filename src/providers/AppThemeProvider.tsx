import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildAppPalette } from "@/lib/colors";

interface AppThemeContextValue {
  appCode: string;
  appName: string;
  primaryHex: string;
}

const DEFAULT = {
  code: "nbhub",
  name: "NBHub",
  primaryHex: "#0EA5E9",
};

const AppThemeContext = createContext<AppThemeContextValue | undefined>(undefined);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(DEFAULT);

  // Hent app-fargen dynamisk fra databasen
  const { data: appRow } = useQuery({
    queryKey: ["app-theme", DEFAULT.code],
    queryFn: async () => {
      const { data } = await supabase
        .from("apps")
        .select("code, display_name, theme_primary_color")
        .eq("code", DEFAULT.code)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!appRow) return;
    setState({
      code: appRow.code,
      name: appRow.display_name ?? DEFAULT.name,
      primaryHex: appRow.theme_primary_color ?? DEFAULT.primaryHex,
    });
  }, [appRow]);

  const palette = useMemo(() => buildAppPalette(state.primaryHex), [state.primaryHex]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-primary", palette.primary);
    root.style.setProperty("--app-primary-foreground", palette.primaryForeground);
    root.style.setProperty("--app-primary-dark", palette.primaryDark);
    root.style.setProperty("--app-primary-light", palette.primaryLight);
    root.style.setProperty("--app-primary-pastel", palette.primaryPastel);
    root.style.setProperty("--app-primary-pastel-border", palette.primaryPastelBorder);
  }, [palette]);

  const value: AppThemeContextValue = {
    appCode: state.code,
    appName: state.name,
    primaryHex: state.primaryHex,
  };

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within AppThemeProvider");
  return ctx;
}
