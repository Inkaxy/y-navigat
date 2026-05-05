/**
 * postMessage protocol between the embedded CakeBuilder iframe and its parent window.
 * All messages are wrapped with `source` + `version` to avoid colliding with other
 * iframe protocols on the same page.
 */

import type { CakeConfig, CakeResult } from "./types";

export const CAKE_BUILDER_SOURCE = "nbos-cake-builder" as const;
export const CAKE_BUILDER_PROTOCOL_VERSION = 1;

export type EmbedToParentMessage =
  | { type: "cake-builder/ready" }
  | { type: "cake-builder/price-changed"; total_ex_mva: number; total_inc_mva: number }
  | { type: "cake-builder/step-changed"; step_index: number; step_name: string }
  | { type: "cake-builder/done"; result: CakeResult }
  | { type: "cake-builder/cancel" }
  | { type: "cake-builder/config-updated" }
  | { type: "cake-builder/error"; message: string };

export type ParentToEmbedMessage =
  | { type: "cake-builder/init"; initialConfig?: CakeConfig }
  | { type: "cake-builder/reset" }
  | { type: "cake-builder/set-theme"; theme: "light" | "dark" };

export interface WrappedMessage<T> {
  source: typeof CAKE_BUILDER_SOURCE;
  version: number;
  payload: T;
}

/**
 * Send a message from the iframe to the parent window.
 * Safely no-ops when not running inside an iframe (e.g. during admin preview).
 */
export function postToParent(msg: EmbedToParentMessage, targetOrigin = "*") {
  if (typeof window === "undefined") return;
  if (window.parent === window) return; // not in iframe
  const wrapped: WrappedMessage<EmbedToParentMessage> = {
    source: CAKE_BUILDER_SOURCE,
    version: CAKE_BUILDER_PROTOCOL_VERSION,
    payload: msg,
  };
  try {
    window.parent.postMessage(wrapped, targetOrigin);
  } catch {
    // ignore — parent may have closed
  }
}

/**
 * Subscribe to messages from the parent. Returns an unsubscribe function.
 */
export function listenFromParent(handler: (msg: ParentToEmbedMessage) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: MessageEvent) => {
    const data = event.data as WrappedMessage<ParentToEmbedMessage> | undefined;
    if (!data || typeof data !== "object") return;
    if (data.source !== CAKE_BUILDER_SOURCE) return;
    if (data.version !== CAKE_BUILDER_PROTOCOL_VERSION) return;
    if (!data.payload || typeof data.payload !== "object") return;
    handler(data.payload);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
