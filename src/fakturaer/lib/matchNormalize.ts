// Felles nøkkel-normalisering for matching av fakturalinjer.
// DENNE FILEN ER BYTE-IDENTISK MED supabase/functions/_shared/matchNormalize.ts.
// Endres den ene, må den andre endres likt — en vitest sammenligner filene.

/**
 * Normaliser en verdi (alias, leverandør-SKU eller beskrivelse) til en
 * sammenlignbar nøkkel:
 *   - små bokstaver
 *   - diakritika fjernes (é → e), men æ, ø og å beholdes
 *   - tegnsetting, bindestrek og punktum blir mellomrom
 *   - mellomrom komprimeres, strengen trimmes
 *   - rene tallstrenger mister ledende nuller («007» → «7»)
 *
 * Databasen normaliserer alias_value bare med lower(trim(...)), så verdien
 * derfra må kjøres gjennom denne funksjonen igjen før sammenligning.
 */
export function normalizeMatchKey(input: string | null | undefined): string {
  if (input == null) return "";
  let s = String(input).toLowerCase();
  // Beskytt de norske vokalene før diakritika strippes.
  s = s.replace(/æ/g, "\u0001").replace(/ø/g, "\u0002").replace(/å/g, "\u0003");
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/\u0001/g, "æ").replace(/\u0002/g, "ø").replace(/\u0003/g, "å");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, "");
  return s;
}

/** Sant når to verdier er like etter normalisering (og begge er ikke-tomme). */
export function matchKeyEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeMatchKey(a);
  const nb = normalizeMatchKey(b);
  return !!na && na === nb;
}
