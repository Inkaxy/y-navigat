import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type UserNameRow = { id: string | null; display_name: string | null; first_name: string | null; last_name: string | null };

/** Visningsnavn — aldri e-post. */
export function userDisplayName(u: UserNameRow | undefined): string | null {
  if (!u) return null;
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return u.display_name?.trim() || full || null;
}

/** Navn for en liste bruker-id-er — én spørring for hele siden. */
export function useUserNames(ids: readonly (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))].sort();
  return useQuery({
    queryKey: ["user-names", uniq],
    enabled: uniq.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ReadonlyMap<string, string>> => {
      const { data, error } = await supabase.from("users_public").select("id, display_name, first_name, last_name").in("id", uniq).limit(uniq.length);
      if (error) throw error;
      const m = new Map<string, string>();
      for (const u of data ?? []) {
        const n = userDisplayName(u);
        if (u.id && n) m.set(u.id, n);
      }
      return m;
    },
  });
}
