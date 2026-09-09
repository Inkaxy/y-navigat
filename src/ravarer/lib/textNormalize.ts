/**
 * Normaliserer søketekst for server-side filtrering mot Matvaretabellen:
 * små bokstaver + NFD-dekomponering med diakritika fjernet, slik at
 * «Crème» og «creme» gir samme treff i `.ilike`-søket.
 */
export function normalizeForServerSearch(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Escaper tegn som har spesialbetydning i et PostgREST `ilike`-mønster. */
export function escapeIlikePattern(text: string): string {
  return text.replace(/[%_,]/g, (c) => `\\${c}`);
}
