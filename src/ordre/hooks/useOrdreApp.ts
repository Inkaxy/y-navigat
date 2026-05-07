import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OrdreApp = {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  status: string;
  theme_primary_color: string | null;
  theme_accent_color: string | null;
  icon: string | null;
};

export function useOrdreApp() {
  return useQuery({
    queryKey: ["app", "ordre"],
    queryFn: async (): Promise<OrdreApp | null> => {
      const { data, error } = await supabase
        .from("apps")
        .select("id, code, display_name, description, status, theme_primary_color, theme_accent_color, icon")
        .eq("code", "ordre")
        .maybeSingle();
      if (error) throw error;
      return data as OrdreApp | null;
    },
    staleTime: 5 * 60_000,
  });
}
