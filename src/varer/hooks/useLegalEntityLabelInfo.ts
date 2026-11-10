import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LabelEntityInfo } from "@/varer/lib/recipeLabelIssues";

/** Kolonnenavnene i `legal_entities` — feltene heter invoice_* i basen. */
interface LegalEntityRow {
  legal_name: string | null;
  display_name: string | null;
  invoice_address_line1: string | null;
  invoice_postal_code: string | null;
  invoice_city: string | null;
}

/**
 * Produsentnavn og adresse til etiketten. Én definisjon for nøkkelen
 * `legal-entity-label`, brukt av merkefanen og «Gjenstår».
 */
export function useLegalEntityLabelInfo(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["legal-entity-label", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<LabelEntityInfo | null> => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("legal_name, display_name, invoice_address_line1, invoice_postal_code, invoice_city")
        .eq("id", legalEntityId!)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as LegalEntityRow | null;
      if (!row) return null;
      return {
        // Etiketten skal bære det juridiske navnet, med visningsnavn som reserve.
        name: row.legal_name ?? row.display_name ?? null,
        address_line1: row.invoice_address_line1 ?? null,
        postal_code: row.invoice_postal_code ?? null,
        city: row.invoice_city ?? null,
      };
    },
  });
}
