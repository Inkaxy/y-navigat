/** Standardiserte råvarekategorier. Rekkefølgen er bevisst og skal ikke sorteres om. */
export const RAW_MATERIAL_CATEGORIES = [
  "Mel og korn",
  "Sukker og søtning",
  "Fett og olje",
  "Meieri og egg",
  "Gjær, hevemidler og bakehjelpemidler",
  "Frø, nøtter og kjerner",
  "Frukt, bær og syltetøy",
  "Sjokolade og kakao",
  "Marsipan, masser og fyll",
  "Dekor og glasur",
  "Smak, krydder og tilsetning",
  "Ferdigmiks og halvfabrikat",
  "Pålegg og delikatesse",
  "Kaffe og te",
  "Drikke",
  "Emballasje",
  "Forbruksvarer",
] as const;

export type RawMaterialCategory = (typeof RAW_MATERIAL_CATEGORIES)[number];

export const CATEGORY_PACKAGING: RawMaterialCategory = "Emballasje";
export const CATEGORY_CONSUMABLES: RawMaterialCategory = "Forbruksvarer";

export interface CategoryGroup {
  label: string;
  items: string[];
}

/** Tre visuelle grupper: bakeråvarer (1–12), kafé og butikk (13–15), ikke-mat (16–17). */
export const CATEGORY_GROUPS: CategoryGroup[] = [
  { label: "Bakeråvarer", items: [...RAW_MATERIAL_CATEGORIES.slice(0, 12)] },
  { label: "Kafé og butikk", items: [...RAW_MATERIAL_CATEGORIES.slice(12, 15)] },
  { label: "Ikke-mat", items: [...RAW_MATERIAL_CATEGORIES.slice(15)] },
];

/**
 * Standardlisten gruppert, unionert med avvikende verdier som allerede finnes i data,
 * slik at ingen eksisterende vare mister verdien sin i en velger.
 */
export function categoryGroups(existing: readonly (string | null | undefined)[] = []): CategoryGroup[] {
  const standard = new Set<string>(RAW_MATERIAL_CATEGORIES);
  const extra = Array.from(
    new Set(existing.filter((c): c is string => !!c && c.trim().length > 0 && !standard.has(c.trim())).map((c) => c.trim())),
  ).sort((a, b) => a.localeCompare(b, "nb"));

  return extra.length > 0
    ? [...CATEGORY_GROUPS, { label: "Andre (eldre verdier)", items: extra }]
    : CATEGORY_GROUPS;
}

/** Flat liste i standard rekkefølge, unionert med avvikende verdier fra data. */
export function categoryOptions(existing: readonly (string | null | undefined)[] = []): string[] {
  return categoryGroups(existing).flatMap((g) => g.items);
}

export function isStandardCategory(value?: string | null): boolean {
  return !!value && (RAW_MATERIAL_CATEGORIES as readonly string[]).includes(value);
}
