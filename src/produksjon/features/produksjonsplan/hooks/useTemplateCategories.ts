import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TemplateCategory } from "../types";

export function useTemplateCategories() {
  return useQuery({
    queryKey: ["produksjonsplan", "template-categories"],
    queryFn: async (): Promise<TemplateCategory[]> => {
      const { data, error } = await supabase
        .from("production_template_categories")
        .select("id, code, label, color_hex, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as TemplateCategory[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
