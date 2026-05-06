import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";

export interface AgreementRow {
  id: string;
  raw_material_id: string;
  supplier_id: string;
  agreed_price: number | null;
  agreement_valid_from: string | null;
  agreement_valid_to: string | null;
  is_primary: boolean;
  raw_material: { id: string; name: string; category: string | null; base_unit: string | null } | null;
  supplier: { id: string; name: string } | null;
}

export function useAgreements() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["agreements", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select(
          "id, raw_material_id, supplier_id, agreed_price, agreement_valid_from, agreement_valid_to, is_primary, raw_material:raw_materials!inner(id, name, category, base_unit, legal_entity_id), supplier:suppliers!inner(id, name)",
        )
        .eq("raw_material.legal_entity_id", legalEntityId)
        .not("agreed_price", "is", null)
        .order("agreement_valid_to", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as AgreementRow[];
    },
  });
}
