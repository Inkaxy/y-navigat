import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { APP_CODE } from "@/ravarer/lib/constants";

export type AccessLevel = "none" | "read" | "write" | "approve" | "admin";

/**
 * Én delt kilde til tilgangsnivået på Råvarer-appen. Både RavarerContext og
 * submenyen bruker denne, slik at `app_access_level` bare kalles én gang.
 */
export function useRavarerAccessLevel(enabled = true) {
  return useQuery({
    queryKey: ["ravarer-access-level"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AccessLevel> => {
      const { data, error } = await supabase.rpc("app_access_level", { p_app_code: APP_CODE });
      if (error) throw error;
      return (data as AccessLevel) ?? "none";
    },
  });
}
