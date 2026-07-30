import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Sjekker om innlogget bruker har skrivetilgang til 'kunder'-appen (vs. kun lesetilgang). */
export function useKunderWriteAccess() {
  return useQuery({
    queryKey: ["kunder", "write-access"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("has_app_write_access", {
        p_app_code: "kunder",
      });
      if (error) throw error;
      return Boolean(data);
    },
    staleTime: 60 * 1000,
  });
}
