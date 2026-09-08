/**
 * Prosent-først i oppskriftseditoren.
 *
 * En del kan registreres på to måter:
 *  - «gram»: brukeren skriver mengder, og bakerprosenten er avledet.
 *  - «%»:    brukeren skriver bakerprosent, og mengden er avledet av melvekten.
 *
 * Registreringsmodusen er en ren editorinnstilling — den lagres ikke i basen, og
 * den endrer aldri tallene i seg selv. Det eneste som skjer, er at %-linjer får
 * mengden regnet om på nytt hver gang melvekten endrer seg, slik at prosentene i
 * skjermbildet aldri er utdaterte.
 */

import {
  bakersPercentFor,
  gramsFromPercent,
  isFlourLine,
  isLineConvertible,
  lineFromGrams,
  lineToGrams,
  type BakersLine,
} from "@/varer/lib/bakers";

/** Registreringsmodus per del. */
export type PartEntryMode = "grams" | "percent";

export const PART_ENTRY_MODE_LABEL: Record<PartEntryMode, string> = {
  grams: "Gram",
  percent: "Prosent",
};

/** Modus per del-id. Deler som mangler i kartet regnes som «gram». */
export type PartEntryModes = Record<string, PartEntryMode>;

export function entryModeFor(modes: PartEntryModes, partId: string | null | undefined): PartEntryMode {
  if (!partId) return "grams";
  return modes[partId] ?? "grams";
}

/** Linjetypen editoren jobber med — minimumskravet for omregningene her. */
export type PercentLine = BakersLine & { id: string; recipe_part_id?: string | null };

/**
 * Regner ut mengden en %-linje skal ha ved gitt melvekt.
 * Returnerer `null` når mengden ikke kan avledes trygt (ukjent omregning,
 * ingen melvekt, eller ingen lagret prosent) — da skal linjen stå urørt.
 */
export function quantityFromPercent(line: PercentLine, totalFlourG: number): number | null {
  if (!(totalFlourG > 0)) return null;
  if (line.bakers_percent == null) return null;
  if (!isLineConvertible(line)) return null;
  const pct = Number(line.bakers_percent);
  if (!Number.isFinite(pct)) return null;
  const quantity = lineFromGrams(gramsFromPercent(pct, totalFlourG), line);
  if (!Number.isFinite(quantity)) return null;
  return Number(quantity.toFixed(3));
}

/**
 * Avleder mengdene på nytt for alle linjer som er registrert i prosent.
 *
 * Melinjer røres aldri: de definerer nevneren, så en re-avledning av dem ville
 * vært sirkulær. Linjer som ikke kan regnes om beholdes uendret.
 *
 * Returnerer den samme referansen når ingenting endret seg, slik at React ikke
 * rendrer på nytt uten grunn.
 */
export function rederivePercentLines<T extends PercentLine>(lines: T[], totalFlourG: number): T[] {
  if (!(totalFlourG > 0)) return lines;
  let changed = false;
  const next = lines.map((line) => {
    if (line.entry_mode !== "percent") return line;
    if (isFlourLine(line)) return line;
    const quantity = quantityFromPercent(line, totalFlourG);
    if (quantity == null) return line;
    if (Number(line.quantity) === quantity) return line;
    changed = true;
    return { ...line, quantity };
  });
  return changed ? next : lines;
}

/**
 * Bakerprosenten som skal vises for en linje akkurat nå.
 *
 * Alltid regnet fra dagens melvekt, aldri fra en lagret verdi som kan ha blitt
 * utdatert av at melmengden er endret. Returnerer `null` når prosenten ikke kan
 * beregnes — da skal feltet stå tomt i stedet for å vise 0 %.
 */
export function livePercentFor(line: PercentLine, totalFlourG: number): number | null {
  if (!(totalFlourG > 0)) return null;
  if (!isLineConvertible(line)) return null;
  const conv = lineToGrams(line);
  if (!conv.exact) return null;
  const pct = bakersPercentFor(line, totalFlourG);
  return Number.isFinite(pct) ? pct : null;
}

/** Nøkkeltall for den utvidede statuslinjen. */
export interface PercentStats {
  totalFlourG: number;
  totalDoughG: number;
  hydrationPct: number | null;
  saltPct: number | null;
  /** Andel av samlet mel som ligger i fordeigsdeler. */
  prefermentedFlourPct: number | null;
}

/**
 * Setter registreringsmodus for en del og forbereder linjene på modusen.
 *
 * Ved bytte til «%» får hver linje som mangler lagret prosent en prosent avledet
 * fra dagens mengde, slik at feltet ikke står tomt. Ved bytte til «gram» røres
 * ingen tall — mengden er allerede sannheten.
 */
export function applyEntryMode<T extends PercentLine>(
  lines: T[],
  partId: string,
  mode: PartEntryMode,
  totalFlourG: number,
): T[] {
  if (mode === "grams") {
    return lines.map((l) => (l.recipe_part_id === partId ? { ...l, entry_mode: "grams" as const } : l));
  }
  return lines.map((line) => {
    if (line.recipe_part_id !== partId) return line;
    if (isFlourLine(line)) return line;
    if (!isLineConvertible(line) || !(totalFlourG > 0)) return line;
    const pct = line.bakers_percent ?? livePercentFor(line, totalFlourG);
    if (pct == null) return line;
    return { ...line, entry_mode: "percent" as const, bakers_percent: Number(Number(pct).toFixed(3)) };
  });
}
