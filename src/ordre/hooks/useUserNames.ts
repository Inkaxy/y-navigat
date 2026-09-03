import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Slår opp visningsnavn for et sett bruker-id-er. Brukes overalt i ticket-UI
 * slik at vi ALDRI viser e-post eller rå uuid som forfatternavn.
 */
export function useUserNames(userIds: (string | null | undefined)[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean) as string[])).sort();
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["ticket-user-names", ids.join(",")],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("users_public")
        .select("id, display_name, first_name, last_name")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const u of (data ?? []) as Array<{
        id: string;
        display_name: string | null;
        first_name: string | null;
        last_name: string | null;
      }>) {
        map[u.id] =
          u.display_name ||
          [u.first_name, u.last_name].filter(Boolean).join(" ") ||
          "Ukjent bruker";
      }
      return map;
    },
  });
}
