import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Id-ene til råvarene som lagerføres — brukes til å vise at oppskriften trekker fra lager. */
export function useStockTrackedRawMaterials() {
  return useQuery({
    queryKey: ["stock-tracked-raw-materials"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id")
        .eq("stock_tracking", true);
      if (error) throw error;
      return new Set((data ?? []).map(r => r.id as string));
    },
  });
}
