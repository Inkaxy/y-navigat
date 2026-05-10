import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMainCategories(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["produksjonsplan", "main-categories", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_main_categories")
        .select("id, code, display_name, sort_order")
        .eq("legal_entity_id", legalEntityId!)
        .order("code");
      if (error) throw error;
      return (data ?? []) as { id: string; code: string; display_name: string; sort_order: number }[];
    },
  });
}

export function useSubCategories(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["produksjonsplan", "sub-categories", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_sub_categories")
        .select("id, code, display_name")
        .eq("legal_entity_id", legalEntityId!)
        .order("code");
      if (error) throw error;
      return (data ?? []) as { id: string; code: string; display_name: string }[];
    },
  });
}

export function useToursForEntity(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["produksjonsplan", "tours", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_tours")
        .select("id, tour_number, display_name")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("tour_number");
      if (error) throw error;
      return (data ?? []) as { id: string; tour_number: number; display_name: string }[];
    },
  });
}

export function useCustomerGroupsForEntity(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["produksjonsplan", "customer-groups", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_groups")
        .select("id, code, display_name")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as { id: string; code: string; display_name: string }[];
    },
  });
}
