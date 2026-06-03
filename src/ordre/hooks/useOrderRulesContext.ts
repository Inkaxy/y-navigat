// Henter konteksten regelmotoren trenger: outlets m/ åpningstider,
// avvikende åpningstider, produkter (lead_time_days) og delivery_rules.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import type {
  Outlet,
  OutletException,
  ProductForRules,
  DeliveryRule,
} from "@/ordre/lib/orderRules";

export type OrderRulesContext = {
  outlets: Outlet[];
  outlet_exceptions: OutletException[];
  products: ProductForRules[];
  delivery_rules: DeliveryRule[];
};

export function useOrderRulesContext(productIds: string[] = []) {
  const ids = [...new Set(productIds)].sort();
  return useQuery({
    queryKey: ["order-rules-context", ids],
    queryFn: async (): Promise<OrderRulesContext> => {
      const [outletsRes, exceptionsRes, productsRes, rulesRes, pickupsRes] = await Promise.all([
        supabase
          .from("outlets")
          .select("id, short_name, full_name, city, status, opening_hours")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("status", "active"),
        supabase
          .from("outlet_opening_exceptions")
          .select("outlet_id, date, closed, periods, note")
          .gte("date", new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
          .lte("date", new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10)),
        ids.length
          ? supabase
              .from("products")
              .select("id, display_name, lead_time_days")
              .in("id", ids)
          : Promise.resolve({ data: [], error: null } as any),
        supabase
          .from("delivery_rules")
          .select("rule_type, weekdays, deadline_time, deadline_days_before, product_ids")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("is_active", true),
        supabase
          .from("pickup_locations" as any)
          .select("id, display_name, city, status")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("status", "active"),
      ]);

      // Slå sammen outlets (med åpningstider) og pickup_locations (hentesteder uten åpningstider).
      // Pickup locations brukes for navn-matching i regelsjekken «Hentested ikke gjenkjent».
      const outletsCombined: Outlet[] = [
        ...((outletsRes.data ?? []) as unknown as Outlet[]),
        ...(((pickupsRes as any).data ?? []) as Array<{
          id: string;
          display_name: string | null;
          city: string | null;
          status: string | null;
        }>).map((p) => ({
          id: p.id,
          short_name: p.display_name,
          full_name: p.display_name,
          city: p.city,
          status: p.status,
          opening_hours: null,
        })),
      ];

      return {
        outlets: outletsCombined,
        outlet_exceptions: (exceptionsRes.data ?? []) as unknown as OutletException[],
        products: (productsRes.data ?? []) as unknown as ProductForRules[],
        delivery_rules: (rulesRes.data ?? []) as unknown as DeliveryRule[],
      };
    },
    staleTime: 60_000,
  });
}
