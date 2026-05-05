import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRow = {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  status: string;
  theme_primary_color: string | null;
  theme_accent_color: string | null;
  icon: string | null;
};

/** Henter apps-rad for code='kunder'. Brukes til tema, header og tilgangskontroll. */
export function useKunderApp() {
  return useQuery({
    queryKey: ["app", "kunder"],
    queryFn: async (): Promise<AppRow | null> => {
      const { data, error } = await supabase
        .from("apps")
        .select("id, code, display_name, description, status, theme_primary_color, theme_accent_color, icon")
        .eq("code", "kunder")
        .maybeSingle();
      if (error) throw error;
      return data as AppRow | null;
    },
    staleTime: 5 * 60_000,
  });
}
