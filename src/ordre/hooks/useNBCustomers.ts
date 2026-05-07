import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";

export type CustomerOption = {
  id: string;
  customer_number: string;
  display_name: string;
  organization_number: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  delivery_country: string | null;
  delivery_instructions: string | null;
  credit_hold: boolean;
  credit_hold_reason: string | null;
  invoice_recipient_customer_id: string | null;
  default_price_list_id: string | null;
  status: string;
};

/** Henter aktive kunder for NB AS — brukes til ordre-opprettelse */
export function useNBCustomers(search?: string) {
  return useQuery({
    queryKey: ["nb-customers", search ?? ""],
    queryFn: async (): Promise<CustomerOption[]> => {
      let q = supabase
        .from("customers")
        .select(
          "id, customer_number, display_name, organization_number, primary_contact_name, primary_contact_email, delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_city, delivery_country, delivery_instructions, credit_hold, credit_hold_reason, invoice_recipient_customer_id, default_price_list_id, status",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .order("display_name")
        .limit(100);

      if (search && search.trim().length > 0) {
        const s = search.trim().replace(/[%,]/g, " ");
        q = q.or(
          [
            `display_name.ilike.%${s}%`,
            `customer_number.ilike.%${s}%`,
            `organization_number.ilike.%${s}%`,
          ].join(","),
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CustomerOption[];
    },
    staleTime: 30_000,
  });
}

export function useCustomerById(id: string | null | undefined) {
  return useQuery({
    queryKey: ["customer", id],
    enabled: !!id,
    queryFn: async (): Promise<CustomerOption | null> => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, customer_number, display_name, organization_number, primary_contact_name, primary_contact_email, delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_city, delivery_country, delivery_instructions, credit_hold, credit_hold_reason, invoice_recipient_customer_id, default_price_list_id, status",
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as CustomerOption | null;
    },
  });
}
