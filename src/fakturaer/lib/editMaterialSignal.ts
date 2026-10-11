/**
 * Signal som åpner «Endre råvare» for ÉN linje (tast M / «Match» i tabellen).
 * Linjebundet, så et signal aldri følger med til neste linje som monteres.
 */
export type EditMaterialSignal = { lineId: string; n: number };

export function shouldOpenEditMaterial(signal: EditMaterialSignal | null | undefined, lineId: string, handledN: number | null): boolean {
  if (!signal || signal.lineId !== lineId) return false;
  return signal.n !== handledN;
}
