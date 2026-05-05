import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ALL_ENTITIES } from "@/state/SelectedEntityContext";

export type CustomerProfileRow = {
  id: string;
  legal_entity_id: string;
  code: string;
  display_name: string;
  description: string | null;
  next_customer_number: number;
  is_private_person_default: boolean;
  payment_terms_days: number | null;
  status: string;
};

export function useCustomerProfiles(scope: string | null) {
  return useQuery({
    queryKey: ["customer-profiles", scope],
    enabled: !!scope,
    queryFn: async () => {
      let q = supabase
        .from("customer_profiles")
        .select(
          "id, legal_entity_id, code, display_name, description, next_customer_number, is_private_person_default, payment_terms_days, status",
        )
        .order("code", { ascending: true });
      if (scope && scope !== ALL_ENTITIES) {
        q = q.eq("legal_entity_id", scope);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CustomerProfileRow[];
    },
  });
}

export function useCustomerProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["customer-profile", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_profiles")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useProfileCustomerCounts(scope: string | null) {
  return useQuery({
    queryKey: ["customer-profile-counts", scope],
    enabled: !!scope,
    queryFn: async (): Promise<Record<string, number>> => {
      let q = supabase
        .from("customers")
        .select("customer_profile_id", { count: "exact", head: false })
        .not("customer_profile_id", "is", null);
      if (scope && scope !== ALL_ENTITIES) {
        q = q.eq("legal_entity_id", scope);
      }
      const { data, error } = await q.limit(10000);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data ?? []) {
        const k = (r as any).customer_profile_id as string | null;
        if (k) counts[k] = (counts[k] ?? 0) + 1;
      }
      return counts;
    },
  });
}

export function useProfilePriceLists(profileId: string | undefined) {
  return useQuery({
    queryKey: ["customer-profile-price-lists", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_profile_price_lists")
        .select("price_list_id, sort_order")
        .eq("customer_profile_id", profileId!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
