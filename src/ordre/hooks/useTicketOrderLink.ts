// Én kilde for ordrekobling på tickets. Både sidefeltet (OrderLinkCard) og
// hurtighandlingene i innboks-widgeten bruker disse, slik at `related_order_id`,
// `ticket_order_links` og tidslinjen alltid holdes i synk.
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logTicketEvent } from "@/ordre/lib/ticketEvents";

export async function linkTicketToOrder(
  ticketId: string,
  orderId: string,
  orderNumber?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("tickets")
    .update({ related_order_id: orderId } as never)
    .eq("id", ticketId);
  if (error) throw error;
  await supabase
    .from("ticket_order_links")
    .upsert({ ticket_id: ticketId, order_id: orderId } as never, {
      onConflict: "ticket_id,order_id",
    });
  await logTicketEvent({
    ticket_id: ticketId,
    order_id: orderId,
    event_type: "ticket.linked_to_order",
    summary: `Koblet til ordre #${orderNumber ?? orderId.slice(0, 8)}`,
  });
}

export async function unlinkTicketFromOrder(
  ticketId: string,
  orderId: string,
  orderNumber?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("tickets")
    .update({ related_order_id: null } as never)
    .eq("id", ticketId);
  if (error) throw error;
  await supabase
    .from("ticket_order_links")
    .delete()
    .eq("ticket_id", ticketId)
    .eq("order_id", orderId);
  await logTicketEvent({
    ticket_id: ticketId,
    order_id: orderId,
    event_type: "ticket.unlinked_from_order",
    summary: `Fjernet kobling til ordre #${orderNumber ?? orderId.slice(0, 8)}`,
  });
}

/** Felles invalidering etter kobling/frakobling. */
export function useInvalidateTicketLinks() {
  const qc = useQueryClient();
  return (ticketId: string) => {
    qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
    qc.invalidateQueries({ queryKey: ["ticket-events", ticketId] });
    qc.invalidateQueries({ queryKey: ["ticket-order-links", ticketId] });
    qc.invalidateQueries({ queryKey: ["cake-images-for", ticketId] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["tickets-counts"] });
  };
}
