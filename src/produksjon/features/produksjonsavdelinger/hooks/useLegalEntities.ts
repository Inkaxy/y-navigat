import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LegalEntityOption {
  id: string;
  legal_name: string;
  short_code: string;
}

/**
 * Lists active legal entities visible to the current user.
 * RLS on legal_entities returns all active rows for authenticated users,
 * but production_departments writes are still gated by has_position_in_entity().
 * Filtering UI to entities the user can write to happens implicitly when mutations fail.
 */
export function useLegalEntities() {
  return useQuery({
    queryKey: ["legal_entities", "active"],
    queryFn: async (): Promise<LegalEntityOption[]> => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, legal_name, short_code")
        .eq("status", "active")
        .order("legal_name", { ascending: true });

      if (error) throw error;
      return (data ?? []) as LegalEntityOption[];
    },
  });
}
