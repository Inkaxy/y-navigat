import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SupplierRow {
  id: string;
  legal_entity_id: string;
  name: string;
  org_number: string | null;
  contact_email: string | null;
  is_active: boolean;
}

export function useSuppliersFor(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["fakturaer-suppliers", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, legal_entity_id, name, org_number, contact_email, is_active")
        .eq("legal_entity_id", legalEntityId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SupplierRow[];
    },
  });
}
