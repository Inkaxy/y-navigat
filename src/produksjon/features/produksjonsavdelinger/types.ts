export interface ProductionDepartment {
  id: string;
  legal_entity_id: string;
  code: string;
  display_name: string;
  sort_order: number;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export interface ProductionDepartmentInput {
  legal_entity_id: string;
  code: string;
  display_name: string;
  sort_order: number;
  status: "active" | "inactive";
}

export interface ProductionDepartmentUpdate {
  id: string;
  display_name: string;
  sort_order: number;
  status: "active" | "inactive";
}
