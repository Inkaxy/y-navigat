import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CustomerContact = {
  id: string;
  customer_id: string;
  legal_entity_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  notes: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CustomerContactInput = {
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  notes?: string | null;
  is_primary?: boolean;
  sort_order?: number;
};

export function useCustomerContacts(customerId: string | undefined) {
  return useQuery({
    queryKey: ["customer-contacts", customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<CustomerContact[]> => {
      const { data, error } = await supabase
        .from("customer_contacts")
        .select("*")
        .eq("customer_id", customerId!)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CustomerContact[];
    },
  });
}

export function useCreateCustomerContact(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomerContactInput) => {
      const { data, error } = await supabase
        .from("customer_contacts")
        .insert({
          customer_id: customerId,
          // legal_entity_id settes av trigger
          legal_entity_id: "00000000-0000-0000-0000-000000000000",
          name: input.name,
          role: input.role ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          mobile: input.mobile ?? null,
          notes: input.notes ?? null,
          is_primary: input.is_primary ?? false,
          sort_order: input.sort_order ?? 0,
        })
        .select()
        .single();
      if (error) throw error;
      return data as CustomerContact;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-contacts", customerId] });
    },
  });
}

export function useUpdateCustomerContact(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<CustomerContactInput>;
    }) => {
      const { error } = await supabase
        .from("customer_contacts")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-contacts", customerId] });
    },
  });
}

export function useDeleteCustomerContact(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("customer_contacts")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-contacts", customerId] });
    },
  });
}
