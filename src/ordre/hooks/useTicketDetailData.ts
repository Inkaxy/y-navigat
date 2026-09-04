// Datakilder som både full ticket-rute og peek-panelet trenger.
// Hentet ut av TicketDetail slik at de to flatene aldri divergerer.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TimelineEventRow } from "@/ordre/components/tickets/TimelineEvent";

export function useTicketEvents(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ["ticket-events", ticketId],
    queryFn: async (): Promise<TimelineEventRow[]> => {
      const { data, error } = await supabase
        .from("ticket_events")
        .select("id, event_type, summary, actor_label, actor_user_id, occurred_at")
        .eq("ticket_id", ticketId!)
        .order("occurred_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TimelineEventRow[];
    },
  });
}

export type TicketCustomer = {
  id: string;
  customer_number: string;
  display_name: string;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
};

/** Slår opp kunden bak avsenderadressen — først primærkontakt, så kontaktliste. */
export function useCustomerCard(senderEmail: string | undefined) {
  return useQuery({
    enabled: !!senderEmail,
    queryKey: ["ticket-customer-card", senderEmail],
    queryFn: async (): Promise<{ customer: TicketCustomer | null; orderCount: number }> => {
      const email = senderEmail!.toLowerCase();
      const { data: byPrimary } = await supabase
        .from("customers")
        .select("id, customer_number, display_name, primary_contact_email, primary_contact_phone")
        .ilike("primary_contact_email", email)
        .limit(1);
      let customer = ((byPrimary ?? [])[0] ?? null) as TicketCustomer | null;
      if (!customer) {
        const { data: contact } = await supabase
          .from("customer_contacts")
          .select(
            "customer_id, phone, mobile, customers:customer_id(id, customer_number, display_name, primary_contact_phone)",
          )
          .ilike("email", email)
          .limit(1);
        const row = (contact ?? [])[0] as
          | {
              customer_id: string;
              phone: string | null;
              mobile: string | null;
              customers: {
                id: string;
                customer_number: string;
                display_name: string;
                primary_contact_phone: string | null;
              } | null;
            }
          | undefined;
        if (row?.customers) {
          customer = {
            id: row.customers.id,
            customer_number: row.customers.customer_number,
            display_name: row.customers.display_name,
            primary_contact_email: email,
            primary_contact_phone:
              row.mobile ?? row.phone ?? row.customers.primary_contact_phone,
          };
        }
      }
      if (!customer) return { customer: null, orderCount: 0 };
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customer.id)
        .gte("ordered_at", since.toISOString());
      return { customer, orderCount: count ?? 0 };
    },
  });
}

export function useLinkedOrder(orderId: string | null) {
  return useQuery({
    enabled: !!orderId,
    queryKey: ["ticket-linked-order", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, delivery_date, delivery_time, customer_id, subtotal_excl_vat, total_incl_vat, legal_entity_id",
        )
        .eq("id", orderId!)
        .maybeSingle();
      if (error) throw error;
      const { data: lines } = await supabase
        .from("order_lines")
        .select("quantity, product_snapshot, notes")
        .eq("order_id", orderId!)
        .limit(6);
      let customerName: string | null = null;
      if (data?.customer_id) {
        const { data: c } = await supabase
          .from("customers")
          .select("display_name")
          .eq("id", data.customer_id)
          .maybeSingle();
        customerName = c?.display_name ?? null;
      }
      return {
        order: data,
        customerName,
        lines: (lines ?? []) as Array<{
          quantity: number;
          product_snapshot: { name?: string } | null;
          notes: string | null;
        }>,
      };
    },
  });
}
