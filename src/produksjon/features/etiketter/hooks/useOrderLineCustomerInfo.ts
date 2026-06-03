import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrderLineCustomerInfo {
  /** Visningsnavn for hentested (pickup_locations.display_name), eller null. */
  pickupLabel: string | null;
  /** Navn på den som skal hente/motta kaken. Prioritert:
   *  orders.final_customer_name → customers.display_name. */
  customerName: string | null;
  /** Formatert leveringsadresse (linje1 + (postnr by)). Prioritert:
   *  ordrens leveringsadresse → kundens leveringsadresse. */
  deliveryAddress: string | null;
  /** Formatert leveringsdato (f.eks. "06.06.26") fra orders.delivery_date. */
  deliveryDate: string | null;
  /** Formatert hentetidspunkt (f.eks. "Hentes kl 10:00") fra orders.delivery_time. */
  pickupTime: string | null;
  /** Kundens telefon, prioritert: order.final_customer_phone → customer.mobile_phone → customer.primary_contact_phone. */
  phone: string | null;
  /** Om kundeordren er betalt. */
  isPaid: boolean;
}


function formatAddress(
  line1: string | null,
  postal: string | null,
  city: string | null,
): string | null {
  const l1 = (line1 || "").trim();
  const post = [postal, city].filter((s) => !!s && String(s).trim().length > 0).join(" ").trim();
  const parts = [l1, post].filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Henter hentested, kundenavn, leveringsadresse, telefon, dato og hentetid for et sett av order_lines.
 *  - Hentested resolves via customer profile_overrides.pickup_location_id først,
 *    ellers customers.customer_profile_id → customer_profiles.pickup_location_id → pickup_locations.display_name.
 *  - Kundenavn prioriterer order.final_customer_name, deretter customer.display_name.
 *  - Leveringsadresse prioriterer ordrens egne felter, ellers kundens delivery_address.
 */
export function useOrderLineCustomerInfo(orderLineIds: string[] | undefined) {
  const ids = (orderLineIds ?? []).filter(Boolean).slice().sort();
  return useQuery({
    queryKey: ["order_line_customer_info", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, OrderLineCustomerInfo>> => {
      const empty: OrderLineCustomerInfo = {
        pickupLabel: null,
        customerName: null,
        deliveryAddress: null,
        deliveryDate: null,
        pickupTime: null,
        phone: null,
        isPaid: false,

      };
      const out: Record<string, OrderLineCustomerInfo> = {};
      for (const id of ids) out[id] = { ...empty };

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
        .select(
          "id, customer_id, final_customer_name, final_customer_phone, delivery_date, delivery_time, delivery_address_line1, delivery_postal_code, delivery_city, use_customer_default_address, is_paid",
        )
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
        {
          profile_id: string | null;
          display_name: string | null;
          mobile: string | null;
          primary: string | null;
          d_line1: string | null;
          d_postal: string | null;
          d_city: string | null;
          profile_overrides: Record<string, unknown>;
        }
      > = {};
      if (customerIds.length > 0) {
        const { data: customers, error: cErr } = await supabase
          .from("customers")
          .select(
            "id, customer_profile_id, profile_overrides, display_name, mobile_phone, primary_contact_phone, delivery_address_line1, delivery_postal_code, delivery_city",
          )
          .in("id", customerIds);
        if (cErr) throw cErr;
        for (const c of customers ?? []) {
          const row = c as {
            id: string;
            customer_profile_id: string | null;
            profile_overrides: Record<string, unknown> | null;
            display_name: string | null;
            mobile_phone: string | null;
            primary_contact_phone: string | null;
            delivery_address_line1: string | null;
            delivery_postal_code: string | null;
            delivery_city: string | null;
          };
          customerMap[row.id] = {
            profile_id: row.customer_profile_id,
            display_name: row.display_name,
            mobile: row.mobile_phone,
            primary: row.primary_contact_phone,
            d_line1: row.delivery_address_line1,
            d_postal: row.delivery_postal_code,
            d_city: row.delivery_city,
            profile_overrides: row.profile_overrides ?? {},
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
          [
            ...Object.values(profileToPickup),
            ...Object.values(customerMap).map((c) => {
              const override = c.profile_overrides.pickup_location_id;
              return typeof override === "string" && override.length > 0 ? override : null;
            }),
          ].filter((x): x is string => !!x),
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
          final_customer_name: string | null;
          final_customer_phone: string | null;
          delivery_date: string | null;
          delivery_time: string | null;
          delivery_address_line1: string | null;
          delivery_postal_code: string | null;
          delivery_city: string | null;
          use_customer_default_address: boolean | null;
          is_paid: boolean | null;
        };

        const cust = row.customer_id ? customerMap[row.customer_id] : null;
        const overridePickup = cust?.profile_overrides.pickup_location_id;
        const pickupId =
          typeof overridePickup === "string" && overridePickup.length > 0
            ? overridePickup
            : cust?.profile_id
              ? profileToPickup[cust.profile_id]
              : null;
        const pickupLabel = pickupId ? pickupMap[pickupId] ?? null : null;

        const customerName = row.final_customer_name?.trim() || cust?.display_name || null;

        const orderAddress = formatAddress(
          row.delivery_address_line1,
          row.delivery_postal_code,
          row.delivery_city,
        );
        const customerAddress = cust
          ? formatAddress(cust.d_line1, cust.d_postal, cust.d_city)
          : null;
        const deliveryAddress =
          row.use_customer_default_address === false
            ? orderAddress ?? customerAddress
            : customerAddress ?? orderAddress;

        const phone = row.final_customer_phone || cust?.mobile || cust?.primary || null;

        const deliveryDate = row.delivery_date
          ? (() => {
              const d = new Date(row.delivery_date);
              const day = String(d.getDate()).padStart(2, "0");
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const yy = String(d.getFullYear()).slice(-2);
              // U+200B (zero-width space) lar dato brytes mellom "06.06." og "26"
              // når "Bryt linje + krymp" er på, men vises som "06.06.26" ellers.
              return `${day}.${mm}.\u200B${yy}`;
            })()
          : null;
        const pickupTime = row.delivery_time
          ? `Hentes kl ${row.delivery_time.slice(0, 5)}`
          : null;

        orderInfo[row.id] = {
          pickupLabel,
          customerName,
          deliveryAddress,
          deliveryDate,
          pickupTime,
          phone,
        };
      }

      for (const l of lines ?? []) {
        const row = l as { id: string; order_id: string };
        out[row.id] = orderInfo[row.order_id] ?? { ...empty };
      }
      return out;
    },
    staleTime: 30_000,
  });
}
