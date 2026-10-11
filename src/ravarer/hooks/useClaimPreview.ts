import { supabase } from "@/integrations/supabase/client";
import { parseClaimPreview, type ClaimPreviewLine } from "@/ravarer/lib/supplierClaim";

/** Fersk serverkontroll av nøyaktig de valgte linjene (ingen cache — grunnlaget sendes tilbake ved oppretting). */
export async function fetchClaimPreview(lineIds: string[]): Promise<ClaimPreviewLine[]> {
  if (lineIds.length === 0) return [];
  const { data, error } = await supabase.rpc("rm_supplier_claim_preview", { p_line_ids: lineIds });
  if (error) throw error;
  return parseClaimPreview(data, lineIds);
}
