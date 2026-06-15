/**
 * Public types for the CakeBuilder feature package.
 * These types form the contract used by embed consumers (POS, Ordre, Kundeportal).
 */

export type SelectionType = "single" | "multi" | "text" | "number";

export interface WizardCategory {
  id: string;
  legal_entity_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  status: string;
  base_product_id: string | null;
  base_price: number | null;
}

export interface WizardOption {
  option_id: string; // cake_step_products.id
  product_id: string | null;
  display_number: number | null;
  display_name: string | null;
  custom_name: string | null;
  is_custom_only: boolean;
  cake_role: string | null;
  mva_rate: number;
  price_ex_mva: number;
  image_url: string | null;
  default_selected: boolean;
  sort_order: number;
  variant_group_label: string | null;
  is_variant_default: boolean;
}

export interface WizardStep {
  id: string;
  name: string;
  step_order: number;
  selection_type: SelectionType;
  required: boolean;
  min_selections: number | null;
  max_selections: number | null;
  description: string | null;
  suggested_role: string | null;
  included_quantity: number;
  extra_unit_price: number;
  options: WizardOption[];
}

export interface WizardRule {
  id: string;
  name: string;
  trigger_product_ids: string[];
  rule_type: string;
  severity: "info" | "warning" | "block";
  message: string;
  response_options: Array<{
    id?: string;
    label: string;
    /** "continue" | "remove_product" | "back" | other */
    action?: string;
    /** Only for action === "remove_product": the product/option id to remove from selections */
    remove_product_id?: string | null;
    is_primary?: boolean;
  }> | null;
  sort_order: number;
}

export interface WizardPriceList {
  id: string;
  code: string;
  display_name: string;
  prices_include_mva: boolean;
}

export interface WizardData {
  category: WizardCategory | null;
  price_list: WizardPriceList | null;
  steps: WizardStep[];
  rules: WizardRule[];
}

export interface PriceLine {
  option_id: string;
  product_id: string | null;
  display_name: string;
  mva_rate: number;
  price: number;
}

export interface PriceBreakdown {
  base_price: number;
  lines: PriceLine[];
  step_overages: Array<{
    step_id: string;
    overage_count: number;
    extra_unit_price: number;
    overage_total: number;
  }>;
  total_ex_mva: number;
  total_inc_mva: number;
}

/**
 * Hovedlinje for ordresystemet. Bærer hele kaken — produksjon ser denne,
 * det er denne kunden faktisk får og betaler for.
 */
export interface CakeOrderLine {
  product_id: string;
  /** Varenummer som ordresystem og produksjon kjenner igjen */
  display_number: number | null;
  display_name: string;
  quantity: number;
  unit_price_excl_vat: number;
  vat_rate: number;
  notes: string;
}

/**
 * Tilbehør-linjer — kun for å fakturere tilleggene riktig. All produksjons-
 * og etikett-info ligger på hovedlinjen / label_payload.
 */
export interface CakeAccessoryLine {
  product_id: string;
  display_number: number | null;
  display_name: string;
  quantity: number;
  unit_price_excl_vat: number;
  vat_rate: number;
  parent_role: string;
}

/**
 * Komplett etikett-pakke som Produksjon-appen skriver ut. Tomt felt = ikke
 * fylt ut (steg uten label_field_key, eller kunden lot det stå tomt).
 */
export interface CakeLabelPayload {
  product_id: string;
  display_number: number | null;
  display_name: string;
  label_mode: string | null;
  label_print_model: string | null;
  customer_name: string | null;
  pickup_location: string | null;
  pickup_date: string | null;
  pickup_tour: string | null;
  pickup_time: string | null;
  cake_text: string | null;
  recipient: string | null;
  note: string | null;
  components: Array<{
    role: string;
    display_name: string;
    display_number: number | null;
  }>;
  total_incl_vat: number;
}

/**
 * What the wizard returns to the consumer when the user clicks "Ferdig".
 * Designed to be persisted as cake_config JSONB on order_lines (F1.3).
 */
export interface CakeResult {
  category_id: string;
  category_name: string;
  price_list_id: string;
  selections: Array<{
    step_id: string;
    step_name: string;
    selection_type: SelectionType;
    option_ids: string[];
    text?: string;
    number?: number;
  }>;
  total_ex_mva: number;
  total_inc_mva: number;
  /** Raw price breakdown snapshot at time of completion */
  price_breakdown: PriceBreakdown;
  /** Hovedlinje for ordrelinje (base-produkt med varenummer) — server-validert */
  order_line: CakeOrderLine;
  /** Sub-linjer for tilbehør med eget produkt — kun for fakturering */
  accessory_lines: CakeAccessoryLine[];
  /** Komplett etikett-payload til Produksjon-appen */
  label_payload: CakeLabelPayload;
  /** Kunde/leveranseinfo fra første side */
  customer_meta?: {
    pickup_date: string | null;
    pickup_location_id: string | null;
    name: string;
    phone: string;
    email: string;
  };
  /** Betalingsmodus valgt på siste side */
  payment_mode?: "now" | "later";
}

/**
 * Skeleton type for re-opening / editing an already-configured cake.
 * Implemented in F1.3.
 */
export interface CakeConfig {
  category_id: string;
  selections: CakeResult["selections"];
}
