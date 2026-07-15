// Sporbarhet for tickets/ordrer. Best-effort logging — UI skal aldri blokkeres av loggfeil.
import { supabase } from "@/integrations/supabase/client";

export type TicketEventType =
  // Ticket-livssyklus
  | "ticket.received"
  | "ticket.assigned"
  | "ticket.unassigned"
  | "ticket.status_changed"
  | "ticket.resolved"
  | "ticket.reopened"
  // AI
  | "ai.analysis_started"
  | "ai.analysis_completed"
  | "ai.analysis_failed"
  | "ai.suggestion_edited"
  // Kobling
  | "ticket.linked_to_order"
  | "ticket.unlinked_from_order"
  | "order.created_from_ticket"
  // Endringer
  | "order.fields_changed"
  | "order.cancelled"
  | "order.status_changed"
  // Kommunikasjon
  | "reply.sent"
  | "confirmation.sent"
  | "customer.replied"
  // Notater
  | "note.added"
  // Kakebilder
  | "cake_image.printed";

export type ActorType = "customer" | "staff" | "ai" | "system";

export const EVENT_LABEL: Record<TicketEventType, string> = {
  "ticket.received": "Epost mottatt",
  "ticket.assigned": "Tildelt ansvarlig",
  "ticket.unassigned": "Fjernet ansvarlig",
  "ticket.status_changed": "Status endret",
  "ticket.resolved": "Markert ferdig",
  "ticket.reopened": "Gjenåpnet",
  "ai.analysis_started": "AI-analyse startet",
  "ai.analysis_completed": "AI-analyse fullført",
  "ai.analysis_failed": "AI-analyse feilet",
  "ai.suggestion_edited": "AI-forslag endret",
  "ticket.linked_to_order": "Koblet til ordre",
  "ticket.unlinked_from_order": "Frakoblet ordre",
  "order.created_from_ticket": "Ordre opprettet fra ticket",
  "order.fields_changed": "Ordre endret",
  "order.cancelled": "Ordre kansellert",
  "order.status_changed": "Ordrestatus endret",
  "reply.sent": "Svar sendt til kunde",
  "confirmation.sent": "Bekreftelse sendt",
  "customer.replied": "Kunde svarte",
  "note.added": "Notat lagt til",
  "cake_image.printed": "Kakebilde skrevet ut",
};

export type LogTicketEventInput = {
  ticket_id?: string | null;
  order_id?: string | null;
  event_type: TicketEventType;
  actor_type?: ActorType;
  summary?: string | null;
  payload?: Record<string, unknown> | null;
  occurred_at?: string;
};

export async function logTicketEvent(input: LogTicketEventInput): Promise<void> {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    const actor_type: ActorType = input.actor_type ?? (user ? "staff" : "system");
    await supabase.from("ticket_events").insert({
      ticket_id: input.ticket_id ?? null,
      order_id: input.order_id ?? null,
      event_type: input.event_type,
      actor_type,
      actor_user_id: user?.id ?? null,
      actor_label: user?.email ?? null,
      summary: input.summary ?? null,
      payload: (input.payload ?? {}) as never,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[ticketEvents] logging failed", e);
  }
}
