import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { CriteriaTemplate, ProduksjonsplanCriteria } from "../types";

export function useCriteriaTemplates(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["produksjonsplan", "templates", legalEntityId],
    queryFn: async (): Promise<CriteriaTemplate[]> => {
      if (!legalEntityId) return [];
      const { data, error } = await supabase
        .from("production_criteria_templates")
        .select("id, legal_entity_id, name, category_code, criteria, created_at, updated_at")
        .eq("legal_entity_id", legalEntityId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as CriteriaTemplate[];
    },
    enabled: !!legalEntityId,
  });
}

export function useSaveCriteriaTemplate(legalEntityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name: string; category_code: string | null; criteria: ProduksjonsplanCriteria }) => {
      if (!legalEntityId) throw new Error("Velg selskap først");
      if (input.id) {
        const { error } = await supabase
          .from("production_criteria_templates")
          .update({ name: input.name, category_code: input.category_code, criteria: input.criteria as never })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("production_criteria_templates")
          .insert({
            legal_entity_id: legalEntityId,
            name: input.name,
            category_code: input.category_code,
            criteria: input.criteria as never,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["produksjonsplan", "templates", legalEntityId] });
      toast.success("Mal lagret");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCriteriaTemplate(legalEntityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("production_criteria_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["produksjonsplan", "templates", legalEntityId] });
      toast.success("Mal slettet");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
