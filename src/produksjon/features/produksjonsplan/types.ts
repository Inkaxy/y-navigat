export interface ProduksjonsplanCriteria {
  /** Tur-numre som skal inkluderes; tom = alle */
  tour_numbers: number[];
  /** Summere alle valgte turer til én sum */
  sum_tours: boolean;
  /** main_category_id-er; tom = alle */
  main_category_ids: string[];
  /** sub_category_id-er; tom = alle */
  sub_category_ids: string[];
  /** Inkluder varer som ikke har sub_category_id satt */
  include_products_without_subcategory: boolean;
  /** Aggregeringsnivå */
  aggregation: "per_product" | "per_main_and_production_group" | "per_production_group";
  /** Sortering */
  sort_by: "default" | "product_number" | "product_name";
  /** Kundegruppe-koder; tom = alle */
  customer_group_ids: string[];
  /** Antall kopier som skrives ut */
  print_copies?: number;
  /** Om siste kopi skal være korreksjonsliste mot siste snapshot samme dag */
  print_correction_last?: boolean;
}

export const DEFAULT_CRITERIA: ProduksjonsplanCriteria = {
  tour_numbers: [],
  sum_tours: true,
  main_category_ids: [],
  sub_category_ids: [],
  include_products_without_subcategory: true,
  aggregation: "per_main_and_production_group",
  sort_by: "product_number",
  customer_group_ids: [],
  print_copies: 1,
  print_correction_last: false,
};

export interface ProductionPlanRow {
  product_id: string;
  product_code: string | null;
  product_name: string;
  unit_of_sale: string | null;
  main_category_id: string | null;
  main_category_code: string | null;
  main_category_name: string | null;
  sub_category_id: string | null;
  production_group_id: string | null;
  production_group_name: string | null;
  dough_type: string | null;
  pieces_per_tray: number | null;
  pieces_per_liter: number | null;
  quantity_ordered: number;
  quantity_from_stock: number;
  quantity_to_produce: number;
  trays_full: number;
  trays_partial: number;
  liters: number | null;
  on_stock: number | null;
  /** Sortering: tur-nummer rad er knyttet til (når sum_tours=false) */
  tour_number: number | null;
}

export interface CriteriaTemplate {
  id: string;
  legal_entity_id: string;
  name: string;
  category_code: string | null;
  criteria: ProduksjonsplanCriteria;
  created_at: string;
  updated_at: string;
}

export interface TemplateCategory {
  id: string;
  code: string;
  label: string;
  color_hex: string;
  sort_order: number;
}
