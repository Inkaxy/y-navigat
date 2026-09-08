/**
 * Allergenutheving som overlever hele veien til etikett og nettbutikk.
 *
 * Beregningen lagrer to varianter av ingredienslisten:
 *  - HTML med <strong>hvete</strong> (vises i NBhub)
 *  - ren tekst med *hvete* (lagres på produktet, brukes av PDF/nettbutikk)
 *
 * Her deles markert tekst opp i segmenter slik at hvert ORD kan settes i fet
 * skrift — aldri hele feltet.
 */
export interface MarkedSegment {
  text: string;
  bold: boolean;
}

/** Deler «Hvetemel (*hvete*), vann» i segmenter med og uten utheving. */
export function splitMarkedText(input: string | null | undefined): MarkedSegment[] {
  const text = input ?? "";
  if (!text) return [];
  const out: MarkedSegment[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

/** Fjerner markørene — for steder som ikke kan vise fet skrift. */
export function stripMarkers(input: string | null | undefined): string {
  return (input ?? "").replace(/\*([^*]+)\*/g, "$1");
}

/** Sann når teksten inneholder minst én uthevet del. */
export function hasMarkers(input: string | null | undefined): boolean {
  return /\*[^*]+\*/.test(input ?? "");
}
