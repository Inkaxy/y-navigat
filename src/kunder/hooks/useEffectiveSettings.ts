import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Henter effektive innstillinger for en kunde — profilens defaults med eventuelle
 * profile_overrides lagt på toppen. Brukes av Ordre/Faktura-apper, men også nyttig
 * i kundedetaljsiden for sanity-check.
 */
export function useEffectiveSettings(customerId: string | undefined) {
  return useQuery({
    queryKey: ["customer-effective-settings", customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<Record<string, any>> => {
      const { data, error } = await supabase.rpc(
        "get_customer_effective_settings" as any,
        { p_customer_id: customerId! },
      );
      if (error) throw error;
      return (data ?? {}) as Record<string, any>;
    },
  });
}
