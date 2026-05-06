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
      const { data, error } = await supabase.rpc("user_has_invoice_access" as any);
      if (error) {
        console.error("invoice access check", error);
        return false;
      }
      return !!data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
