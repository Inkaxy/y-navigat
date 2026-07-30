/**
 * postMessage protocol between the embedded CakeBuilder iframe and its parent window.
 * All messages are wrapped with `source` + `version` to avoid colliding with other
 * iframe protocols on the same page.
 */

import type { CakeConfig, CakeResult } from "./types";
import { isAllowedOrigin } from "./origins";

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
  | { type: "cake-builder/set-theme"; theme: "light" | "dark" }
  | { type: "cake-builder/set-session"; access_token: string; refresh_token: string };

export interface WrappedMessage<T> {
  source: typeof CAKE_BUILDER_SOURCE;
  version: number;
  payload: T;
}

/**
 * Derive a safe, allowlisted target origin for posting to the parent window.
 * Prefers an explicitly provided origin, falls back to `document.referrer`.
 * Returns null if no valid, allowlisted origin can be established.
 */
function resolveTargetOrigin(explicitOrigin?: string): string | null {
  if (explicitOrigin && isAllowedOrigin(explicitOrigin)) return explicitOrigin;
  if (typeof document !== "undefined" && document.referrer) {
    try {
      const refOrigin = new URL(document.referrer).origin;
      if (isAllowedOrigin(refOrigin)) return refOrigin;
    } catch {
      // ignore malformed referrer
    }
  }
  return null;
}

/**
 * Send a message from the iframe to the parent window.
 * Safely no-ops when not running inside an iframe (e.g. during admin preview)
 * or when no allowlisted target origin can be established.
 */
export function postToParent(msg: EmbedToParentMessage, targetOrigin?: string) {
  if (typeof window === "undefined") return;
  if (window.parent === window) return; // not in iframe
  const resolved = resolveTargetOrigin(targetOrigin);
  if (!resolved) return; // no allowlisted origin — do not broadcast to "*"
  const wrapped: WrappedMessage<EmbedToParentMessage> = {
    source: CAKE_BUILDER_SOURCE,
    version: CAKE_BUILDER_PROTOCOL_VERSION,
    payload: msg,
  };
  try {
    window.parent.postMessage(wrapped, resolved);
  } catch {
    // ignore — parent may have closed
  }
}

/**
 * Subscribe to messages from the parent. Returns an unsubscribe function.
 * Ignores messages whose origin is not on the allowlist.
 */
export function listenFromParent(handler: (msg: ParentToEmbedMessage) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: MessageEvent) => {
    if (!isAllowedOrigin(event.origin)) return;
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
