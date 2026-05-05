/** Sentral konstanter for Varer-appen. */
export const APP_CODE = "varer" as const;
export const APP_SOURCE = "varer" as const;

/** Nøtterø Bakeri AS — låst selskap for hele appen. */
export const NB_LEGAL_ENTITY_ID = "751709bc-04b3-4449-867d-b97faa9ab373" as const;
export const NB_SHORT_CODE = "NB" as const;
export const NB_LEGAL_NAME = "Nøtterø Bakeri AS" as const;

export const PRODUCT_STATUSES = ["draft", "active", "paused", "discontinued"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const UNITS_OF_SALE = ["stk", "pakke", "kg", "g", "liter"] as const;
export type UnitOfSale = (typeof UNITS_OF_SALE)[number];

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: "Utkast",
  active: "Aktiv",
  paused: "På pause",
  discontinued: "Utgått",
};

export const MVA_RATES = [
  { value: 15, label: "H — Middels sats (15%)" },
  { value: 25, label: "F — Full sats (25%)" },
  { value: 12, label: "L — Lav sats (12%)" },
  { value: 0, label: "Null (0%)" },
] as const;

export const LABEL_MODE_OPTIONS = [
  { value: "none", label: "Ingen etikett" },
  { value: "per_unit", label: "Per stk" },
  { value: "per_order_or_note", label: "Per ordre eller merknad" },
  { value: "per_note", label: "Per merknad" },
] as const;
export type LabelMode = (typeof LABEL_MODE_OPTIONS)[number]["value"];

export const LABEL_MODE_HELP: Record<LabelMode, string> = {
  none: "Ingen etikett skrives ut for denne varen.",
  per_unit: "Én etikett per bestilte stk (kvantum rundes opp).",
  per_order_or_note: "Én etikett per ordre + én ekstra per ordre med merknad.",
  per_note: "Kun én etikett per ordre som har en merknad.",
};

export const LABEL_PRINT_MODEL_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "orig_plus_copy", label: "Original + kopi" },
] as const;
export type LabelPrintModel = (typeof LABEL_PRINT_MODEL_OPTIONS)[number]["value"];

export const LABEL_PRINT_MODEL_HELP: Record<LabelPrintModel, string> = {
  standard: "Én utskrift per etikett.",
  orig_plus_copy: "To utskrifter per etikett: original + kopi (sortert i bunke).",
};

// ===== Kakebygger =====

export const CAKE_ROLE_OPTIONS = [
  { value: "base", label: "Base (kake-bunn)" },
  { value: "topping", label: "Topping / Pynt" },
  { value: "filling", label: "Fyll" },
  { value: "customization", label: "Tilpasning" },
  { value: "info", label: "Info-merke" },
] as const;
export type CakeRole = (typeof CAKE_ROLE_OPTIONS)[number]["value"];

export const CAKE_ROLE_LABEL: Record<CakeRole, string> = {
  base: "Base",
  topping: "Topping",
  filling: "Fyll",
  customization: "Tilpasning",
  info: "Info-merke",
};

export const CAKE_CATEGORY_STATUS_LABEL: Record<string, string> = {
  active: "Aktiv",
  draft: "Utkast",
  discontinued: "Utgått",
};

export const CAKE_SELECTION_TYPE_OPTIONS = [
  { value: "single", label: "Single (radio)" },
  { value: "multi", label: "Multi (checkbox)" },
  { value: "text", label: "Tekstinput" },
  { value: "number", label: "Tall-input" },
] as const;
export type CakeSelectionType = (typeof CAKE_SELECTION_TYPE_OPTIONS)[number]["value"];

/** Etikett-felt et tekst-/tall-steg kan mappes til. NULL = vanlig steg. */
export const CAKE_LABEL_FIELD_OPTIONS = [
  { value: "customer_name", label: "Kunde-navn" },
  { value: "pickup_location", label: "Hentested" },
  { value: "pickup_date", label: "Hente-dato" },
  { value: "pickup_tour", label: "Tur" },
  { value: "pickup_time", label: "Hente-tidspunkt" },
  { value: "cake_text", label: "Tekst på kake" },
  { value: "recipient", label: "Mottaker" },
  { value: "note", label: "Merknad" },
] as const;
export type CakeLabelFieldKey = (typeof CAKE_LABEL_FIELD_OPTIONS)[number]["value"];

/** Heuristikk: Henrik kan navngi steg fritt. Mapping brukes kun til myk sortering
 *  (matchende rolle øverst i produktvelger). */
export function suggestRoleFromStepName(stepName: string): CakeRole {
  const n = stepName.toLowerCase();
  if (n.includes("pynt") || n.includes("topping")) return "topping";
  if (n.includes("fyll")) return "filling";
  if (n.includes("tilpasning") || n.includes("merknad")) return "customization";
  if (n.includes("allerg") || n.includes("info")) return "info";
  return "base";
}

