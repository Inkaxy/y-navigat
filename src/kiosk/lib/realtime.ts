import type { RealtimeChannel } from "@supabase/supabase-js";
import type { CustomerCartPayload } from "./cart";

export const CART_UPDATE_EVENT = "cart_update";

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
