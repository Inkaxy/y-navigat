import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type AccessLevel = "none" | "read" | "write" | "approve" | "admin";

export interface AppWithAccess {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  category: string;
  icon: string | null;
  status: string;
  deploy_url: string | null;
  theme_primary_color: string | null;
  access_level: AccessLevel;
}

export function useApps() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["apps-with-access", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<AppWithAccess[]> => {
      const { data: apps, error } = await supabase
        .from("apps")
        .select("id, code, display_name, description, category, icon, status, deploy_url, theme_primary_color, sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;

      const results = await Promise.all(
        (apps ?? []).map(async (a) => {
          const { data: level } = await supabase.rpc("app_access_level", { p_app_code: a.code });
          return { ...a, access_level: (level ?? "none") as AccessLevel };
        }),
      );
      return results;
    },
  });
}
