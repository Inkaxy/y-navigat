import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PackingArea, PackingAreaInput, PackingAreaUpdate } from "../types";

const UNIQUE_VIOLATION = "23505";

export class DuplicatePackingAreaCodeError extends Error {
  constructor(public code: string) {
    super(`Koden "${code}" er allerede i bruk i dette selskapet.`);
    this.name = "DuplicatePackingAreaCodeError";
  }
}

export function useCreatePackingArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PackingAreaInput): Promise<PackingArea> => {
      const { data, error } = await supabase
        .from("packing_areas")
        .insert({
          legal_entity_id: input.legal_entity_id,
          code: input.code,
          display_name: input.display_name,
          display_order: input.display_order,
          notes: input.notes,
          status: "active",
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new DuplicatePackingAreaCodeError(input.code);
        }
        throw error;
      }
      return data as PackingArea;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packing_areas"] });
    },
  });
}

export function useUpdatePackingArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PackingAreaUpdate): Promise<PackingArea> => {
      const patch: {
        display_name: string;
        display_order: number;
        notes: string | null;
        code?: string;
      } = {
        display_name: input.display_name,
        display_order: input.display_order,
        notes: input.notes,
      };
      if (typeof input.code === "string") {
        patch.code = input.code;
      }

      const { data, error } = await supabase
        .from("packing_areas")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) {
        if (error.code === UNIQUE_VIOLATION && typeof input.code === "string") {
          throw new DuplicatePackingAreaCodeError(input.code);
        }
        throw error;
      }
      return data as PackingArea;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packing_areas"] });
    },
  });
}

export function useArchivePackingArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (area: PackingArea): Promise<PackingArea> => {
      const { data, error } = await supabase
        .from("packing_areas")
        .update({ status: "archived" })
        .eq("id", area.id)
        .select("*")
        .single();

      if (error) throw error;
      return data as PackingArea;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packing_areas"] });
    },
  });
}

export function useRestorePackingArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (area: PackingArea): Promise<PackingArea> => {
      const { data, error } = await supabase
        .from("packing_areas")
        .update({ status: "active" })
        .eq("id", area.id)
        .select("*")
        .single();

      if (error) throw error;
      return data as PackingArea;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packing_areas"] });
    },
  });
}
