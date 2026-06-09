import type { RealtimeChannel } from "@supabase/supabase-js";
import type { CustomerCartPayload } from "./cart";

export const CART_UPDATE_EVENT = "cart_update";
export const SALE_COMPLETE_EVENT = "sale_complete";

export interface SaleCompletePayload {
  receipt_number: string | null;
  total_incl_mva: number;
  change_given: number;
  timestamp: number;
}

export async function broadcastCart(
  channel: RealtimeChannel,
  payload: CustomerCartPayload,
): Promise<void> {
  try {
    await channel.send({
      type: "broadcast",
      event: CART_UPDATE_EVENT,
      payload,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[kiosk] broadcastCart failed", e);
  }
}

export async function broadcastSaleComplete(
  channel: RealtimeChannel,
  payload: SaleCompletePayload,
): Promise<void> {
  try {
    await channel.send({
      type: "broadcast",
      event: SALE_COMPLETE_EVENT,
      payload,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[kiosk] broadcastSaleComplete failed", e);
  }
}
