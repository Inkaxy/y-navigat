import { supabase } from "@/integrations/supabase/client";
import { logTicketEvent } from "@/ordre/lib/ticketEvents";

/**
 * Massehandlinger i innboksen. Bruker kun eksisterende kolonner og
 * eksisterende hendelseslogging — ingen nye databasefelter.
 */
export type BulkAction = "assign_me" | "waiting" | "resolve";

export const BULK_LABEL: Record<BulkAction, string> = {
  assign_me: "Ta selv",
  waiting: "Merk som venter",
  resolve: "Ferdigbehandle",
};

async function applyOne(id: string, action: BulkAction, userId: string | null) {
  if (action === "assign_me") {
    if (!userId) throw new Error("Mangler innlogget bruker");
    const { error } = await supabase
      .from("tickets")
      .update({ assigned_to: userId, status: "in_progress" } as never)
      .eq("id", id);
    if (error) throw error;
    await logTicketEvent({
      ticket_id: id,
      event_type: "ticket.assigned",
      actor_type: "staff",
      summary: "Tok saken selv",
    });
    return;
  }
  if (action === "waiting") {
    const { error } = await supabase
      .from("tickets")
      .update({ awaiting_internal: true } as never)
      .eq("id", id);
    if (error) throw error;
    await logTicketEvent({
      ticket_id: id,
      event_type: "ticket.status_changed",
      actor_type: "staff",
      summary: "Merket som venter på oppfølging",
    });
    return;
  }
  const { error } = await supabase
    .from("tickets")
    .update({ status: "resolved" } as never)
    .eq("id", id);
  if (error) throw error;
  await logTicketEvent({
    ticket_id: id,
    event_type: "ticket.resolved",
    actor_type: "staff",
    summary: "Ferdigbehandlet",
  });
}

/** Kjører handlingen på alle valgte saker og rapporterer hvor mange som feilet. */
export async function runBulkAction(
  ids: string[],
  action: BulkAction,
  userId: string | null,
): Promise<{ ok: number; failed: number }> {
  const results = await Promise.allSettled(ids.map((id) => applyOne(id, action, userId)));
  return {
    ok: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  };
}
