/** Statuser en faktura kan flagges fra. Avstemte fakturaer kan ikke flagges. */
export const FLAGGABLE_STATUSES = ["imported", "needs_review", "ready"] as const;

export function isFlaggable(status: string | null | undefined): boolean {
  return (FLAGGABLE_STATUSES as readonly string[]).includes(status ?? "");
}

/** Melding etter flagging: hvor mange som ble flagget og hvor mange som ble hoppet over. */
export function flagSummary(requested: number, flagged: number): { flagged: number; skipped: number; text: string } {
  const skipped = Math.max(0, requested - flagged);
  const head = flagged === 0
    ? "Ingen fakturaer ble flagget"
    : flagged === 1 ? "Faktura flagget for oppfølging" : `${flagged} fakturaer flagget for oppfølging`;
  const tail = skipped > 0 ? ` — ${skipped} hoppet over (avstemt eller allerede flagget)` : "";
  return { flagged, skipped, text: head + tail };
}
