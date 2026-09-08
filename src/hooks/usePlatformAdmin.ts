import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Er brukeren plattform-administrator? Samme kontroll som edge-funksjonene
 * gjør, slik at vi kan skjule lenker brukeren likevel ville fått avvist på.
 */
export function usePlatformAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-platform-admin", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_platform_admin");
      if (error) throw error;
      return Boolean(data);
    },
  });
}
