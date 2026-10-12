import type { Recovery } from "./LiveConfirmationStatus";

/**
 * Fanens minne (ikke varig): gjenoppretting per forhandling overlever navigasjon og
 * avmontering i samme fane, slik at A åpnet på nytt viser sin egen status/oppfølging.
 */
export const tabRecovery = new Map<string, Recovery>();
/** Kun for tester. */
export function __resetLiveRecoveryMemory() { tabRecovery.clear(); }
export function restore(id: string): Recovery | null {
  const r = tabRecovery.get(id);
  if (!r) return null;
  // Et pågående steg i en tidligere visning er ikke lenger aktivt her.
  return r.kind === "uncertain" ? { ...r, reread: r.reread === "pending" || r.reread === "ok" ? "idle" : r.reread, readAt: null } : { ...r, retrying: false };
}

