import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Company {
  id: string;
  legal_name: string;
  display_name: string;
  short_code: string;
  org_number: string;
  founded_year: number | null;
}

/**
 * NBhub er ett firma. Denne hooken henter den ene raden i `legal_entities`
 * og brukes overalt der vi tidligere lot brukeren velge selskap.
 */
export function useCompany() {
  return useQuery({
    queryKey: ["company"],
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Company | null> => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, legal_name, display_name, short_code, org_number, founded_year")
        .eq("status", "active")
        .order("short_code")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        legal_name: data.legal_name,
        display_name: data.display_name ?? data.legal_name,
        short_code: data.short_code,
        org_number: data.org_number,
        founded_year: data.founded_year,
      };
    },
  });
}
