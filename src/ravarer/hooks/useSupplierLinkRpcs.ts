import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import {
  moveLegacyReasonText,
  parseMoveLegacyAgreedPrice,
  setPrimarySupplier,
} from "@/ravarer/lib/supplierLinkRpc";

/** Setter (eller fjerner) primærleverandør atomisk via `rm_set_primary_supplier`. */
export function useSetPrimarySupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { rawMaterialId: string; supplierId: string | null; silent?: boolean }) =>
      setPrimarySupplier(input.rawMaterialId, input.supplierId),
    onSuccess: (res, v) => {
      invalidateRawMaterial(qc, v.rawMaterialId);
      if (!v.silent) toast.success(res.supplier_id ? "Primærleverandør satt" : "Primærleverandør fjernet");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Flytter eldre `raw_materials.agreed_price` til leverandørkoblingen. */
export function useMoveLegacyAgreedPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rawMaterialId: string; supplierId: string; validFrom?: string; validTo?: string }) => {
      const { data, error } = await supabase.rpc("rm_move_legacy_agreed_price", {
        p_raw_material_id: input.rawMaterialId,
        p_supplier_id: input.supplierId,
        ...(input.validFrom ? { p_valid_from: input.validFrom } : {}),
        ...(input.validTo ? { p_valid_to: input.validTo } : {}),
      });
      if (error) throw new Error("Avtaleprisen kunne ikke flyttes");
      const res = parseMoveLegacyAgreedPrice(data);
      if (!res.ok) throw new Error(moveLegacyReasonText(res));
      return res;
    },
    onSuccess: (_r, v) => {
      invalidateRawMaterial(qc, v.rawMaterialId);
      toast.success("Avtaleprisen er flyttet til leverandørkoblingen");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
