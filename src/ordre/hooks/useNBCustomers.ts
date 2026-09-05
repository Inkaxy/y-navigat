import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

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
  geocode_latitude: number | null;
  geocode_longitude: number | null;
  custom_reference: string | null;
  enforce_custom_reference: boolean;
  credit_days: number | null;
  notes: string | null;
};

/** Henter aktive kunder for NB AS — brukes til ordre-opprettelse */
export function useNBCustomers(search?: string, options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive === true;
  return useQuery({
    queryKey: ["nb-customers", search ?? "", includeInactive],
    queryFn: async (): Promise<CustomerOption[]> => {
      let q = supabase
        .from("customers")
        .select(
          "id, customer_number, display_name, organization_number, primary_contact_name, primary_contact_email, delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_city, delivery_country, delivery_instructions, credit_hold, credit_hold_reason, invoice_recipient_customer_id, default_price_list_id, status, credit_days, notes, geocode_latitude, geocode_longitude",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
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
      if (!includeInactive) q = q.eq("status", "active");
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as CustomerOption[];
      // Aktive kunder først — inaktive vises nedtonet nederst.
      return rows.slice().sort((a, b) => {
        const aActive = a.status === "active" ? 0 : 1;
        const bActive = b.status === "active" ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return a.display_name.localeCompare(b.display_name, "nb");
      });
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
          "id, customer_number, display_name, organization_number, primary_contact_name, primary_contact_email, delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_city, delivery_country, delivery_instructions, credit_hold, credit_hold_reason, invoice_recipient_customer_id, default_price_list_id, status, credit_days, notes, geocode_latitude, geocode_longitude",
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as CustomerOption | null;
    },
  });
}
