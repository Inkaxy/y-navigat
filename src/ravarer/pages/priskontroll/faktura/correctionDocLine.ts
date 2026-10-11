/**
 * Hvilken linje dokumentpanelet i «Rett fakturalinje» skal vise.
 * Åpen retting vinner alltid over køens aktive linje; finnes ikke linjen (ennå), vises ingen linje
 * — aldri en annen linje fra et tidligere valg.
 */
export function correctionDocLine<L extends { id: string }>(correctFor: string | null, lines: readonly L[], active: L | null): L | null {
  if (correctFor) return lines.find((l) => l.id === correctFor) ?? null;
  return active;
}
