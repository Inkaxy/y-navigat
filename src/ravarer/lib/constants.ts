/** Sentral konstanter for Råvarer-appen. */
import { CANONICAL_BASE_UNITS, CANONICAL_PACKAGE_UNITS } from "@/fakturaer/lib/units";

export const APP_CODE = "ravarer" as const;


/** Nøtterø Bakeri AS — default selskap (samme som Varer i Pulje 1). */
export const NB_LEGAL_ENTITY_ID = "751709bc-04b3-4449-867d-b97faa9ab373" as const;

// Enhetene kommer fra den kanoniske lista i units.ts — samme som kostprismotoren
// og `normalizeUnit` kjenner. Egne lister her ga stille ignorerte pakninger.
export const BASE_UNITS = CANONICAL_BASE_UNITS;
export type BaseUnit = (typeof CANONICAL_BASE_UNITS)[number];

export const PACKAGE_UNITS = CANONICAL_PACKAGE_UNITS;


export { RAW_MATERIAL_CATEGORIES } from "@/ravarer/lib/categories";

export const PRICE_SOURCES = [
  { value: "manual", label: "Manuell" },
  { value: "agreement", label: "Avtale" },
  { value: "price_list", label: "Prisliste" },
  { value: "invoice", label: "Faktura" },
] as const;

export const ALLERGENS = [
  { value: "gluten_wheat", label: "Gluten — hvete", group: "Gluten" },
  { value: "gluten_rye", label: "Gluten — rug", group: "Gluten" },
  { value: "gluten_barley", label: "Gluten — bygg", group: "Gluten" },
  { value: "gluten_oats", label: "Gluten — havre", group: "Gluten" },
  { value: "gluten_spelt", label: "Gluten — spelt", group: "Gluten" },
  { value: "crustaceans", label: "Krepsdyr", group: "Sjømat" },
  { value: "fish", label: "Fisk", group: "Sjømat" },
  { value: "molluscs", label: "Bløtdyr", group: "Sjømat" },
  { value: "eggs", label: "Egg", group: "Animalsk" },
  { value: "milk", label: "Melk", group: "Animalsk" },
  { value: "peanuts", label: "Peanøtter", group: "Nøtter" },
  { value: "nuts_almond", label: "Mandler", group: "Nøtter" },
  { value: "nuts_hazelnut", label: "Hasselnøtter", group: "Nøtter" },
  { value: "nuts_walnut", label: "Valnøtter", group: "Nøtter" },
  { value: "nuts_cashew", label: "Cashewnøtter", group: "Nøtter" },
  { value: "nuts_pecan", label: "Pekannøtter", group: "Nøtter" },
  { value: "nuts_brazil", label: "Paranøtter", group: "Nøtter" },
  { value: "nuts_pistachio", label: "Pistasjenøtter", group: "Nøtter" },
  { value: "nuts_macadamia", label: "Macadamianøtter", group: "Nøtter" },
  { value: "soybeans", label: "Soya", group: "Annet" },
  { value: "celery", label: "Selleri", group: "Annet" },
  { value: "mustard", label: "Sennep", group: "Annet" },
  { value: "sesame", label: "Sesamfrø", group: "Annet" },
  { value: "sulphites", label: "Svoveldioksid/sulfitt", group: "Annet" },
  { value: "lupin", label: "Lupin", group: "Annet" },
] as const;

export type AllergenValue = (typeof ALLERGENS)[number]["value"];

export const ALLERGEN_PRESENCE = [
  { value: "contains", label: "Inneholder" },
  { value: "may_contain", label: "Kan inneholde spor" },
  { value: "free_from", label: "Fri for" },
] as const;

export const COUNTRY_OPTIONS = [
  { value: "NO", label: "Norge" },
  { value: "SE", label: "Sverige" },
  { value: "DK", label: "Danmark" },
  { value: "FI", label: "Finland" },
  { value: "DE", label: "Tyskland" },
  { value: "FR", label: "Frankrike" },
  { value: "IT", label: "Italia" },
  { value: "ES", label: "Spania" },
  { value: "NL", label: "Nederland" },
  { value: "PL", label: "Polen" },
  { value: "GB", label: "Storbritannia" },
  { value: "US", label: "USA" },
  { value: "EU", label: "EU (samlet)" },
  { value: "NON_EU", label: "Ikke-EU" },
] as const;

/** EU 1169/2011 energiformel: kJ pr 100 g. */
export function calcEnergyKj(opts: {
  fat?: number | null;
  carbs?: number | null;
  protein?: number | null;
  fiber?: number | null;
}): number {
  const fat = Number(opts.fat ?? 0);
  const carbs = Number(opts.carbs ?? 0);
  const protein = Number(opts.protein ?? 0);
  const fiber = Number(opts.fiber ?? 0);
  return Math.round((37 * fat + 17 * carbs + 17 * protein + 8 * fiber) * 10) / 10;
}

export function kjToKcal(kj: number): number {
  return Math.round((kj / 4.184) * 10) / 10;
}

export function formatNok(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium" }).format(d);
}
