import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LabelFlaggedProduct, LabelMode } from "../types";

export function useLabelFlaggedProducts(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["label_flagged_products", legalEntityId ?? null],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<LabelFlaggedProduct[]> => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_number, display_name, label_mode")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .neq("label_mode", "none")
        .order("display_number", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id as string,
        display_number: Number(row.display_number),
        display_name: row.display_name as string,
        label_mode: row.label_mode as LabelMode,
      }));
    },
  });
}
