// Deterministisk pastell-fargepalette pr hovedkategori-kode.
// Brukes som linjefarge på produksjonsplan / pakkeliste / korreksjonsliste,
// både på skjerm og i utskrift, slik at varegrupper er lette å skille visuelt.

const PALETTE: Array<{ bg: string; print: string }> = [
  { bg: "hsl(48 95% 88%)",  print: "#fff3c4" }, // gul
  { bg: "hsl(140 55% 85%)", print: "#d8f0d4" }, // grønn
  { bg: "hsl(200 70% 88%)", print: "#cfe6f5" }, // lyseblå
  { bg: "hsl(20 85% 88%)",  print: "#fbdac2" }, // oransje
  { bg: "hsl(280 50% 90%)", print: "#e6d4ee" }, // lilla
  { bg: "hsl(0 70% 90%)",   print: "#f7d4d4" }, // rosa
  { bg: "hsl(170 50% 84%)", print: "#cfe9e2" }, // teal
  { bg: "hsl(60 70% 86%)",  print: "#eef0c4" }, // limegul
  { bg: "hsl(220 55% 90%)", print: "#d8e2f5" }, // duvblå
  { bg: "hsl(330 55% 90%)", print: "#f1d6e6" }, // fuchsia
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export interface CategoryColor {
  /** Bakgrunn på skjerm (HSL) */
  bg: string;
  /** Bakgrunn ved utskrift (hex, fungerer best med print-color-adjust) */
  print: string;
}

/**
 * Returnerer en stabil farge for en hovedkategori-kode.
 * Samme kode gir alltid samme farge, men spredt jevnt over paletten.
 */
export function categoryColor(code: string | null | undefined): CategoryColor | null {
  if (!code) return null;
  const idx = hashCode(code) % PALETTE.length;
  return PALETTE[idx];
}
