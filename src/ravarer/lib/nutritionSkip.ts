/**
 * «Hopp over» i næringslisten gjelder økten (fanen) og deles med råvarekortets forrige/neste,
 * slik at detaljnavigasjonen følger nøyaktig samme liste som brukeren så. Per selskap.
 */
const key = (entity: string | null) => `ravarer:naering:hoppet:${entity ?? "-"}`;

export function readNutritionSkipped(entity: string | null): Set<string> {
  try {
    const raw = sessionStorage.getItem(key(entity));
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch (e: unknown) {
    console.error("[naering:hoppet:les]", e);
    return new Set();
  }
}

export function writeNutritionSkipped(entity: string | null, ids: ReadonlySet<string>): void {
  try {
    sessionStorage.setItem(key(entity), JSON.stringify([...ids]));
  } catch (e: unknown) {
    console.error("[naering:hoppet:lagre]", e);
  }
}
