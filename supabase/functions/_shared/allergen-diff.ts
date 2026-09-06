// DENNE FILEN ER BYTE-IDENTISK MED supabase/functions/_shared/allergen-diff.ts.
// Endres den ene, må den andre endres likt — en vitest sammenligner filene.
// Kanoniske allergenkoder (enum raw_material_allergens.allergen) med validering og diff.

export const ALLERGEN_CODES = [
  "gluten_wheat",
  "gluten_rye",
  "gluten_barley",
  "gluten_oats",
  "gluten_spelt",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts_almond",
  "nuts_hazelnut",
  "nuts_walnut",
  "nuts_cashew",
  "nuts_pecan",
  "nuts_brazil",
  "nuts_pistachio",
  "nuts_macadamia",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type AllergenCode = (typeof ALLERGEN_CODES)[number];
export type AllergenPresence = "contains" | "may_contain" | "free_from";

/** Vanlige feilskrivinger fra AI og eldre data. */
const ALIASES: Record<string, AllergenCode> = {
  egg: "eggs",
  eg: "eggs",
  hen_egg: "eggs",
  soy: "soybeans",
  soya: "soybeans",
  soja: "soybeans",
  soybean: "soybeans",
  melk: "milk",
  dairy: "milk",
  wheat: "gluten_wheat",
  hvete: "gluten_wheat",
  rye: "gluten_rye",
  barley: "gluten_barley",
  oats: "gluten_oats",
  oat: "gluten_oats",
  spelt: "gluten_spelt",
  peanut: "peanuts",
  sulfites: "sulphites",
  sulfitt: "sulphites",
  sulphite: "sulphites",
  shellfish: "crustaceans",
  crustacean: "crustaceans",
  mollusc: "molluscs",
  mollusk: "molluscs",
  molluscs_shellfish: "molluscs",
  sesame_seeds: "sesame",
  almond: "nuts_almond",
  hazelnut: "nuts_hazelnut",
  walnut: "nuts_walnut",
  cashew: "nuts_cashew",
  pecan: "nuts_pecan",
  brazil_nut: "nuts_brazil",
  pistachio: "nuts_pistachio",
  macadamia: "nuts_macadamia",
};

/** Gjør en fri kode om til gyldig enum-verdi, eller null når den ikke kan tolkes. */
export function normalizeAllergenCode(value: unknown): AllergenCode | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((ALLERGEN_CODES as readonly string[]).includes(key)) return key as AllergenCode;
  return ALIASES[key] ?? null;
}

export function normalizeAllergenPresence(value: unknown): AllergenPresence | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (key === "contains" || key === "may_contain" || key === "free_from") return key;
  if (key === "inneholder") return "contains";
  if (key === "kan_inneholde" || key === "traces" || key === "may contain") return "may_contain";
  if (key === "fri_for" || key === "free from") return "free_from";
  return null;
}

export interface AllergenState {
  allergen: string;
  presence: string;
}

export interface AllergenEntry {
  allergen: AllergenCode;
  presence: AllergenPresence;
}

export interface AllergenDiff {
  /** Nye allergener som skal settes inn. */
  added: AllergenEntry[];
  /** Allergener som finnes fra før, men med ny styrke. */
  changed: { allergen: AllergenCode; from: string; to: AllergenPresence }[];
  /** Allergener som ikke lenger står på databladet og skal fjernes. */
  removed: { allergen: string; presence: string }[];
  /** Uleselige koder fra AI — logges, brukes ikke. */
  rejected: string[];
}

/**
 * Sammenligner eksisterende allergener med det databladet oppgir.
 * Fjerning skjer bare når databladet faktisk oppga allergener (`incoming` ikke tom),
 * slik at et tomt uttrekk ikke tømmer råvaren.
 */
export function diffAllergens(
  existing: readonly AllergenState[],
  incoming: readonly { allergen?: unknown; presence?: unknown }[],
): AllergenDiff {
  const diff: AllergenDiff = { added: [], changed: [], removed: [], rejected: [] };
  const wanted = new Map<AllergenCode, AllergenPresence>();

  for (const item of incoming ?? []) {
    const code = normalizeAllergenCode(item?.allergen);
    const presence = normalizeAllergenPresence(item?.presence) ?? "contains";
    if (!code) {
      const raw = typeof item?.allergen === "string" ? item.allergen : String(item?.allergen ?? "");
      if (raw && !diff.rejected.includes(raw)) diff.rejected.push(raw);
      continue;
    }
    // «contains» vinner over «may_contain» hvis begge er oppgitt.
    const prev = wanted.get(code);
    if (prev === "contains") continue;
    wanted.set(code, presence);
  }

  const existingMap = new Map<string, string>();
  for (const e of existing ?? []) existingMap.set(e.allergen, e.presence);

  for (const [code, presence] of wanted) {
    const current = existingMap.get(code);
    if (current === undefined) diff.added.push({ allergen: code, presence });
    else if (current !== presence) diff.changed.push({ allergen: code, from: current, to: presence });
  }

  if (wanted.size > 0) {
    for (const [allergen, presence] of existingMap) {
      if (presence === "free_from") continue;
      if (!wanted.has(allergen as AllergenCode)) diff.removed.push({ allergen, presence });
    }
  }

  return diff;
}
