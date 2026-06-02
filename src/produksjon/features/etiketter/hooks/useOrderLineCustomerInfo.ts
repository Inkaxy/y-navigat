import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrderLineCustomerInfo {
  /** Visningsnavn for hentested (pickup_locations.display_name), eller null. */
  pickupLabel: string | null;
  /** Kundens telefon, prioritert: order.final_customer_phone → customer.mobile_phone → customer.primary_contact_phone. */
  /** Formatert leveringsdato (f.eks. "02.06.2026") fra orders.delivery_date. */
  deliveryDate: string | null;
  /** Formatert hentetidspunkt (f.eks. "Hentes kl 10:00") fra orders.delivery_time. */
  pickupTime: string | null;
  phone: string | null;
}

/**
 * Henter hentested og telefonnummer for et sett av order_lines.
 *  - Hentested resolves via orders.customer_id → customers.customer_profile_id →
 *    customer_profiles.pickup_location_id → pickup_locations.display_name.
 *  - Telefon prioriterer order.final_customer_phone, deretter customer.mobile_phone /
 *    primary_contact_phone.
 */
export function useOrderLineCustomerInfo(orderLineIds: string[] | undefined) {
  const ids = (orderLineIds ?? []).filter(Boolean).slice().sort();
  return useQuery({
    queryKey: ["order_line_customer_info", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, OrderLineCustomerInfo>> => {
      const out: Record<string, OrderLineCustomerInfo> = {};
      for (const id of ids) out[id] = { pickupLabel: null, phone: null, deliveryDate: null, pickupTime: null };

      const { data: lines, error } = await supabase
        .from("order_lines")
        .select("id, order_id")
        .in("id", ids);
      if (error) throw error;

      const orderIds = Array.from(
        new Set((lines ?? []).map((l) => (l as { order_id: string }).order_id)),
      );
      if (orderIds.length === 0) return out;

      const { data: orders, error: oErr } = await supabase
        .from("orders")
        .select("id, customer_id, final_customer_phone, delivery_date, delivery_time")
        .in("id", orderIds);
      if (oErr) throw oErr;

      const customerIds = Array.from(
        new Set(
          (orders ?? [])
            .map((o) => (o as { customer_id: string | null }).customer_id)
            .filter((x): x is string => !!x),
        ),
      );

      const customerMap: Record<
        string,
        { profile_id: string | null; mobile: string | null; primary: string | null }
      > = {};
      if (customerIds.length > 0) {
        const { data: customers, error: cErr } = await supabase
          .from("customers")
          .select("id, customer_profile_id, mobile_phone, primary_contact_phone")
          .in("id", customerIds);
        if (cErr) throw cErr;
        for (const c of customers ?? []) {
          const row = c as {
            id: string;
            customer_profile_id: string | null;
            mobile_phone: string | null;
            primary_contact_phone: string | null;
          };
          customerMap[row.id] = {
            profile_id: row.customer_profile_id,
            mobile: row.mobile_phone,
            primary: row.primary_contact_phone,
          };
        }
      }

      const profileIds = Array.from(
        new Set(
          Object.values(customerMap)
            .map((c) => c.profile_id)
            .filter((x): x is string => !!x),
        ),
      );

      const profileToPickup: Record<string, string | null> = {};
      if (profileIds.length > 0) {
        const { data: profiles, error: pErr } = await supabase
          .from("customer_profiles")
          .select("id, pickup_location_id")
          .in("id", profileIds);
        if (pErr) throw pErr;
        for (const p of profiles ?? []) {
          const row = p as { id: string; pickup_location_id: string | null };
          profileToPickup[row.id] = row.pickup_location_id;
        }
      }

      const pickupIds = Array.from(
        new Set(
          Object.values(profileToPickup).filter((x): x is string => !!x),
        ),
      );
      const pickupMap: Record<string, string> = {};
      if (pickupIds.length > 0) {
        const { data: pickups, error: piErr } = await supabase
          .from("pickup_locations")
          .select("id, display_name")
          .in("id", pickupIds);
        if (piErr) throw piErr;
        for (const p of pickups ?? []) {
          const row = p as { id: string; display_name: string };
          pickupMap[row.id] = row.display_name;
        }
      }

      const orderInfo: Record<string, OrderLineCustomerInfo> = {};
      for (const o of orders ?? []) {
        const row = o as {
          id: string;
          customer_id: string | null;
          final_customer_phone: string | null;
          delivery_date: string | null;
          delivery_time: string | null;
        };
        const cust = row.customer_id ? customerMap[row.customer_id] : null;
        const pickupId = cust?.profile_id ? profileToPickup[cust.profile_id] : null;
        const pickupLabel = pickupId ? pickupMap[pickupId] ?? null : null;
        const phone =
          row.final_customer_phone || cust?.mobile || cust?.primary || null;
        const deliveryDate = row.delivery_date
          ? (() => {
              const d = new Date(row.delivery_date);
              const day = String(d.getDate()).padStart(2, "0");
              const months = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des"];
              const mon = months[d.getMonth()];
              const yy = String(d.getFullYear()).slice(-2);
              return `${day}.${mon}.${yy}`;
            })()
          : null;
        const pickupTime = row.delivery_time
          ? `Hentes kl ${row.delivery_time.slice(0, 5)}`
          : null;
        orderInfo[row.id] = { pickupLabel, phone, deliveryDate, pickupTime };
      }

      for (const l of lines ?? []) {
        const row = l as { id: string; order_id: string };
        out[row.id] = orderInfo[row.order_id] ?? { pickupLabel: null, phone: null, deliveryDate: null, pickupTime: null };
      }
      return out;
    },
    staleTime: 30_000,
  });
}
