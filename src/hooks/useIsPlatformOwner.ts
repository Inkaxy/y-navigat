import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useIsPlatformOwner() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-platform-owner", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_platform_owner", {
        _user_id: user!.id,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}
