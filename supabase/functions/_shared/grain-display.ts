/**
 * Grovhetsprosent slik den sendes ut og vises sammen med Brødskala'n-merket.
 *
 * BKLF-regel: tallet under streken skal alltid stemme med kategorien i merket
 * (Fint 0–25,9 %, Halvgrovt 26–50,9 %, Grovt 51–75,9 %, Ekstra grovt 76–100 %).
 * Kategorien avgjøres av den uavrundede prosenten (`breadscale_step`: under
 * 26 / 51 / 76). Visningstallet rundes derfor alltid NED til helt tall:
 * 25,6 → 25 (Fint), 50,9 → 50 (Halvgrovt), 26,4 → 26 (Halvgrovt).
 * Vanlig avrunding ville gitt «26 %» ved siden av Fint-merket.
 *
 * Lagrede verdier endres aldri — dette er bare tallet som går ut.
 * Speiles i klienten av `grainDisplayPct` i `src/varer/lib/breadscale.ts`.
 */
export function grainDisplayPct(pct: number | string | null | undefined): number | null {
  if (pct == null || pct === "") return null;
  const n = typeof pct === "number" ? pct : Number(pct);
  if (!Number.isFinite(n)) return null;
  // Ren floor: floor(x) ≤ x, så x < 26 gir alltid ≤ 25 og x ≥ 26 alltid ≥ 26.
  // Ingen epsilon — den kunne løftet 25,9999… over grensen til feil kategori.
  return Math.floor(n);
}
