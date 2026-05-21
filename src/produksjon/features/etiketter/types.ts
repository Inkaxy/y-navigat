export type LabelMode = "none" | "per_unit" | "per_order" | "per_order_or_note" | "per_note";
export type LabelPrintModel = "standard" | "orig_plus_copy";

export interface LabelProductRow {
  product_id: string;
  display_number: number;
  display_name: string;
  label_mode: LabelMode;
  label_print_model: LabelPrintModel;
  department_ids: string[];
  total_labels: number;
  order_line_ids: string[];
  unique_notes: string[];
}

export interface DeliveryTour {
  id: string;
  legal_entity_id: string;
  tour_number: number;
  display_name: string;
  status: "active" | "inactive";
}

export interface LabelScreenFilter {
  date: string; // ISO YYYY-MM-DD
  legalEntityId: string;
  tourIds: string[] | null; // null = alle
  departmentIds: string[] | null; // null = alle
}

export interface LabelChangeCounts {
  newCount: number;
  changedCount: number;
  deletedCount: number;
}

export interface LabelFlaggedProduct {
  id: string;
  display_number: number;
  display_name: string;
  label_mode: LabelMode;
}
