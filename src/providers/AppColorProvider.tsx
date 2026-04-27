import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hexToHslParts, hslString, mixWithBlack } from "@/lib/colors";

/**
 * AppColorProvider
 * ----------------
 * Reads the current app's color_hex from `apps` (filtered by the app's `code`)
 * and writes --app-color, --app-color-deep, --app-color-soft to :root.
 *
 * Default appCode is "nbhub". NEVER hardcode an app color — always use vars.
 */

const DEFAULT_HEX = "#0EA5E9"; // NBHub sky — fallback only

interface AppColorContextValue {
  appCode: string;
  hex: string;
  isLoading: boolean;
}

const AppColorContext = createContext<AppColorContextValue | undefined>(undefined);

interface Props {
  appCode?: string;
  children: ReactNode;
}

export function AppColorProvider({ appCode = "nbhub", children }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["app-color", appCode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("apps")
        .select("color_hex")
        .eq("code", appCode)
        .maybeSingle();
      if (error) throw error;
      return data?.color_hex ?? DEFAULT_HEX;
    },
    staleTime: 10 * 60 * 1000,
  });

  const hex = data ?? DEFAULT_HEX;

  const cssVars = useMemo(() => {
    const base = hexToHslParts(hex);
    const deep = mixWithBlack(hex, 0.2);
    return {
      "--app-color": hslString(base.h, base.s, base.l),
      "--app-color-deep": hslString(deep.h, deep.s, deep.l),
      "--app-color-soft": hslString(base.h, base.s, base.l),
    } as React.CSSProperties;
  }, [hex]);

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(cssVars).forEach(([k, v]) => root.style.setProperty(k, v as string));
  }, [cssVars]);

  const value: AppColorContextValue = { appCode, hex, isLoading };

  return (
    <AppColorContext.Provider value={value}>
      <div style={cssVars} className="contents">
        {children}
      </div>
    </AppColorContext.Provider>
  );
}

export function useAppColor() {
  const ctx = useContext(AppColorContext);
  if (!ctx) throw new Error("useAppColor must be used within AppColorProvider");
  return ctx;
}
