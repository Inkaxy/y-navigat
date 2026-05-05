import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProductionDepartment } from "../types";

export function useProductionDepartments(
  legalEntityId: string | "all" | undefined,
  includeInactive: boolean,
) {
  return useQuery({
    queryKey: ["production_departments", legalEntityId ?? null, includeInactive],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<ProductionDepartment[]> => {
      let query = supabase
        .from("production_departments")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true });

      if (legalEntityId && legalEntityId !== "all") {
        query = query.eq("legal_entity_id", legalEntityId);
      }

      if (!includeInactive) {
        query = query.eq("status", "active");
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ProductionDepartment[];
    },
  });
}
