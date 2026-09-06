import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Antallet linjer i behandlingskøen — brukt som badge i menyen.
 * Flaggede og avstemte fakturaer filtreres bort i SPØRRINGEN, slik at badgen
 * alltid stemmer med det brukeren faktisk ser i køen.
 */
export function useReviewCount() {
  return useQuery({
    queryKey: ["fakturaer-review-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("invoice_lines")
        .select("id, invoices!inner(status)", { count: "exact", head: true })
        .eq("requires_review", true)
        .not("invoices.status", "in", "(flagged,reconciled)");
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });
}
