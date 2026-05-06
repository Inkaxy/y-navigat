import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Realtime/polling count for sidebar badge. */
export function useReviewCount() {
  return useQuery({
    queryKey: ["fakturaer-review-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("invoice_lines")
        .select("id", { count: "exact", head: true })
        .eq("requires_review", true);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });
}
