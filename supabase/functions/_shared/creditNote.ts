// DENNE FILEN ER BYTE-IDENTISK MED src/fakturaer/lib/creditNote.ts.
// Endres den ene, må den andre endres likt — en vitest sammenligner filene.

/** Slik skrives koblingen fra en kreditnota til den opprinnelige fakturaen. */
export const CREDIT_NOTE_REF_PREFIX = "Opprinnelig faktura:";

/**
 * Fakturanummeret kreditnotaen er knyttet til, eller null når koblingen mangler.
 * Databasen har ingen egen kolonne for dette, så referansen leses fra notatet.
 */
export function creditNoteOriginalRef(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = new RegExp(`${CREDIT_NOTE_REF_PREFIX}\\s*(\\S+)`, "i").exec(notes);
  return m ? m[1] : null;
}
