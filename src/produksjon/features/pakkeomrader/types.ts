export interface PackingArea {
  id: string;
  legal_entity_id: string;
  code: string;
  display_name: string;
  display_order: number;
  status: "active" | "archived";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackingAreaInput {
  legal_entity_id: string;
  code: string;
  display_name: string;
  display_order: number;
  notes: string | null;
}

export interface PackingAreaUpdate {
  id: string;
  display_name: string;
  display_order: number;
  notes: string | null;
  // code only included when allowed (no usage in product_packing_areas)
  code?: string;
}
