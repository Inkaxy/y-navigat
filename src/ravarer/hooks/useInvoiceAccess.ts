import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sjekker om innlogget bruker har invoice_access flag på Råvarer-appen
 * (for noen av legal_entities de er knyttet til). Brukes til å vise/skjule
 * Fakturaer-seksjonen i Råvarer-sidebar og guarde rutene.
 */
export function useInvoiceAccess() {
  return useQuery({
    queryKey: ["ravarer-invoice-access"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase
        .from("position_app_access")
        .select("invoice_access, apps!inner(code), positions!inner(user_positions!inner(user_id))")
        .eq("apps.code", "ravarer")
        .eq("positions.user_positions.user_id", uid)
        .eq("invoice_access", true)
        .limit(1);
      if (error) {
        console.error("invoice access check", error);
        return false;
      }
      return (data?.length ?? 0) > 0;
    },
    staleTime: 5 * 60 * 1000,
  });
}
