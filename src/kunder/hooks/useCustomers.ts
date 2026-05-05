import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ALL_ENTITIES } from "@/kunder/state/SelectedEntityContext";

export type CustomerListRow = {
  id: string;
  customer_number: string;
  display_name: string;
  customer_type: string;
  organization_number: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  legal_entity_id: string;
  credit_limit: number | null;
  credit_hold: boolean;
  default_price_list_id: string | null;
  status: string;
  allows_returns: boolean;
};

export type CustomerFilters = {
  search?: string;
  customerType?: string; // 'all' | 'business' | 'consumer' | 'internal'
  status?: string; // 'all' | 'active' | 'inactive'
  creditHold?: string; // 'all' | 'no' | 'yes'
  allowsReturns?: string; // 'all' | 'yes' | 'no'
};

export function useCustomers(scope: string | null, filters: CustomerFilters) {
  return useQuery({
    queryKey: ["customers", scope, filters],
    enabled: !!scope,
    queryFn: async (): Promise<CustomerListRow[]> => {
      let q = supabase
        .from("customers")
        .select(
          "id, customer_number, display_name, customer_type, organization_number, primary_contact_name, primary_contact_email, legal_entity_id, credit_limit, credit_hold, default_price_list_id, status, allows_returns",
        )
        .order("display_name", { ascending: true })
        .limit(500);

      if (scope && scope !== ALL_ENTITIES) {
        q = q.eq("legal_entity_id", scope);
      }
      if (filters.customerType && filters.customerType !== "all") {
        q = q.eq("customer_type", filters.customerType);
      }
      if (filters.status && filters.status !== "all") {
        q = q.eq("status", filters.status);
      }
      if (filters.creditHold === "yes") q = q.eq("credit_hold", true);
      if (filters.creditHold === "no") q = q.eq("credit_hold", false);
      if (filters.allowsReturns === "yes") q = q.eq("allows_returns", true);
      if (filters.allowsReturns === "no") q = q.eq("allows_returns", false);

      if (filters.search && filters.search.trim().length > 0) {
        const s = filters.search.trim().replace(/[%,]/g, " ");
        const or = [
          `display_name.ilike.%${s}%`,
          `customer_number.ilike.%${s}%`,
          `organization_number.ilike.%${s}%`,
          `primary_contact_name.ilike.%${s}%`,
          `primary_contact_email.ilike.%${s}%`,
        ].join(",");
        q = q.or(or);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CustomerListRow[];
    },
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: ["customer", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function usePriceLists(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["price-lists", legalEntityId],
    enabled: !!legalEntityId && legalEntityId !== ALL_ENTITIES,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, code, display_name, is_default, status, legal_entity_id")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("is_default", { ascending: false })
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}
