import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";

export interface SupplierRow {
  id: string;
  legal_entity_id: string;
  name: string;
  org_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  notes: string | null;
}

export function useSuppliers() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["suppliers", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SupplierRow[];
    },
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  const { legalEntityId } = useRavarer();
  return useMutation({
    mutationFn: async (input: { name: string; org_number?: string; contact_email?: string; contact_phone?: string }) => {
      const { data, error } = await supabase
        .from("suppliers")
        .insert({ ...input, legal_entity_id: legalEntityId })
        .select()
        .single();
      if (error) throw error;
      return data as SupplierRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Leverandør opprettet");
    },
    onError: (e: any) => toast.error(`Kunne ikke opprette: ${e.message ?? e}`),
  });
}
