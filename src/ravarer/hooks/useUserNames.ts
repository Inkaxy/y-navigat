import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";

export type UserNameRow = { id: string | null; display_name: string | null; first_name: string | null; last_name: string | null };

/** Visningsnavn — aldri e-post. */
export function userDisplayName(u: UserNameRow | undefined): string | null {
  if (!u) return null;
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return u.display_name?.trim() || full || null;
}

/** Høyst så mange id-er per kall (`rm_user_names`). */
export const USER_NAMES_MAX = 500;

export const FORMER_USER = "Tidligere bruker";

/** Typet lesing av `rm_user_names`: navn eller «Tidligere bruker», aldri e-post. */
export function parseUserNames(rows: readonly { id: string | null; name: string | null; active: boolean | null }[] | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows ?? []) {
    if (!r.id) continue;
    m.set(r.id, r.name?.trim() || FORMER_USER);
  }
  return m;
}

/**
 * Navn for en liste bruker-id-er — ett kall for hele siden via `rm_user_names`
 * (RLS på `users_public` viser bare deg selv). Også deaktiverte brukere.
 */
export function useUserNames(ids: readonly (string | null | undefined)[]) {
  const { data: company } = useCompany();
  const uniq = [...new Set(ids.filter((x): x is string => !!x))].sort().slice(0, USER_NAMES_MAX);
  return useQuery({
    queryKey: ["user-names", company?.id ?? null, uniq],
    enabled: uniq.length > 0 && !!company?.id,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ReadonlyMap<string, string>> => {
      const { data, error } = await supabase.rpc("rm_user_names", { p_legal_entity_id: company?.id as string, p_user_ids: uniq });
      if (error) throw new Error("Kunne ikke hente brukernavn");
      return parseUserNames(data);
    },
  });
}
