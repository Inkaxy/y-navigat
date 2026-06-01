import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type GeocodeResult = { ok: true; lat: number; lon: number; skipped?: boolean; display_name?: string };

export function useGeocodeCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { customer_id: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke<GeocodeResult>("geocode-customer", {
        body: vars,
      });
      if (error) throw error;
      if (!data) throw new Error("Ingen respons fra geocode-customer");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["nb-customer", vars.customer_id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

/**
 * Trigg automatisk geokoding når en kunde har leveringsadresse men mangler
 * koordinater. Kjører én gang per kunde-id per sesjon for å unngå spam.
 */
export function useAutoGeocodeCustomer(customer: {
  id?: string | null;
  delivery_address_line1?: string | null;
  delivery_postal_code?: string | null;
  delivery_city?: string | null;
  geocode_latitude?: number | null;
  geocode_longitude?: number | null;
} | null | undefined) {
  const { mutate } = useGeocodeCustomer();
  const triedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!customer?.id) return;
    if (customer.geocode_latitude != null && customer.geocode_longitude != null) return;
    const hasAddr = !!(customer.delivery_address_line1 || customer.delivery_postal_code || customer.delivery_city);
    if (!hasAddr) return;
    if (triedRef.current.has(customer.id)) return;
    triedRef.current.add(customer.id);
    mutate({ customer_id: customer.id });
  }, [customer?.id, customer?.geocode_latitude, customer?.geocode_longitude, customer?.delivery_address_line1, customer?.delivery_postal_code, customer?.delivery_city, mutate]);
}
