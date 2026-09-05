import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/ordre/lib/audit";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { OrderConflictError } from "@/ordre/lib/orderConflict";
import type { OrderStatus } from "@/ordre/lib/orderStatus";

export type ChangeStatusInput = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  comment?: string;
  userId: string | null;
  /** Hvis avvist/avbrutt — settes cancelled_* */
  isCancel?: boolean;
};

/**
 * Eneste skrivepunkt for manuell statusendring på ordre.
 * Tedebe-modellen har kun tre overganger: godkjenn, avvis og avbryt.
 */
export async function changeOrderStatus(input: ChangeStatusInput) {
  const now = new Date().toISOString();
  const isCancel = input.isCancel || input.toStatus === "cancelled";

  const updates: Record<string, unknown> = {
    status: input.toStatus,
    status_changed_at: now,
    status_changed_by: input.userId,
    updated_at: now,
  };

  if (isCancel) {
    updates.cancelled_at = now;
    updates.cancelled_by = input.userId;
    updates.cancelled_reason = input.comment ?? null;
  }
  if (input.toStatus === "confirmed") {
    updates.confirmed_at = now;
    updates.confirmed_by = input.userId;
  }

  // Optimistisk lås: raden må fremdeles stå på statusen brukeren så.
  const { data: updated, error } = await supabase
    .from("orders")
    .update(updates as never)
    .eq("id", input.orderId)
    .eq("status", input.fromStatus)
    .select("id");
  if (error) throw error;
  if (!updated || updated.length === 0) throw new OrderConflictError();

  // Kansellert ordre → flagg kakebildene så de ikke printes/telles videre.
  if (isCancel) {
    try {
      const { data: imgs } = await supabase
        .from("cake_images")
        .select("id, notes")
        .eq("order_id", input.orderId);
      for (const img of (imgs ?? []) as Array<{ id: string; notes: string | null }>) {
        const flag = `⚠️ Ordre ${input.orderNumber} er kansellert — skal ikke produseres`;
        await supabase
          .from("cake_images")
          .update({
            status: "venter",
            notes: img.notes?.includes(flag) ? img.notes : [flag, img.notes].filter(Boolean).join("\n"),
          } as never)
          .eq("id", img.id);
      }
    } catch (cakeErr) {
      console.warn("[changeOrderStatus] kunne ikke flagge kakebilder", cakeErr);
    }
  }

  // Lagre kommentar på siste status_history-rad (best effort)
  if (input.comment) {
    const { data: latest } = await supabase
      .from("order_status_history")
      .select("id")
      .eq("order_id", input.orderId)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.id) {
      await supabase
        .from("order_status_history")
        .update({ notes: input.comment })
        .eq("id", latest.id);
    }
  }

  await logAudit({
    action: "status_changed",
    entity_type: "order",
    entity_id: input.orderId,
    entity_display_reference: `${input.orderNumber} — ${input.customerName}`,
    legal_entity_id: NB_LEGAL_ENTITY_ID,
    changes: {
      from: input.fromStatus,
      to: input.toStatus,
      comment: input.comment ?? null,
    },
  });
}
