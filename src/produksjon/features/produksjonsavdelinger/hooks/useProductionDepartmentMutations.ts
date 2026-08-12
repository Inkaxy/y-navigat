import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  ProductionDepartment,
  ProductionDepartmentInput,
  ProductionDepartmentUpdate,
} from "../types";

const UNIQUE_VIOLATION = "23505";

export class DuplicateCodeError extends Error {
  constructor(public code: string) {
    super(`Koden "${code}" er allerede i bruk i dette selskapet.`);
    this.name = "DuplicateCodeError";
  }
}

export function useCreateProductionDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductionDepartmentInput): Promise<ProductionDepartment> => {
      const { data, error } = await supabase
        .from("production_departments")
        .insert({
          legal_entity_id: input.legal_entity_id,
          code: input.code,
          display_name: input.display_name,
          sort_order: input.sort_order,
          status: input.status,
          low_stock_alert_email: input.low_stock_alert_email,
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new DuplicateCodeError(input.code);
        }
        throw error;
      }
      return data as ProductionDepartment;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_departments"] });
    },
  });
}

export function useUpdateProductionDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductionDepartmentUpdate): Promise<ProductionDepartment> => {
      const { data, error } = await supabase
        .from("production_departments")
        .update({
          display_name: input.display_name,
          sort_order: input.sort_order,
          status: input.status,
          low_stock_alert_email: input.low_stock_alert_email,
        })
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) throw error;
      return data as ProductionDepartment;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_departments"] });
    },
  });
}

export function useToggleProductionDepartmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dept: ProductionDepartment): Promise<ProductionDepartment> => {
      const nextStatus: ProductionDepartment["status"] =
        dept.status === "active" ? "inactive" : "active";
      const { data, error } = await supabase
        .from("production_departments")
        .update({ status: nextStatus })
        .eq("id", dept.id)
        .select("*")
        .single();

      if (error) throw error;
      return data as ProductionDepartment;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_departments"] });
    },
  });
}
