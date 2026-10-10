import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { setPrimarySupplier } from "@/ravarer/lib/supplierLinkRpc";
import type { ItemType } from "@/ravarer/lib/itemTypes";

/**
 * Massehandlinger fra varelisten. Én samlet toast — ikke én per rad.
 * Primærleverandør går via `rm_set_primary_supplier` per råvare.
 */
export type BulkPatch =
  | { kind: "category"; category: string }
  | { kind: "item_type"; itemType: ItemType }
  | { kind: "active"; isActive: boolean }
  | { kind: "primary_supplier"; supplierId: string };

interface RawMaterialPatch {
  category?: string;
  item_type?: ItemType;
  is_active?: boolean;
}

function patchFor(patch: Exclude<BulkPatch, { kind: "primary_supplier" }>): RawMaterialPatch {
  switch (patch.kind) {
    case "category":
      return { category: patch.category };
    case "item_type":
      return { item_type: patch.itemType };
    case "active":
      return { is_active: patch.isActive };
  }
}

function labelFor(patch: BulkPatch, count: number): string {
  switch (patch.kind) {
    case "category":
      return `${count} varer fikk kategorien «${patch.category}»`;
    case "item_type":
      return `${count} varer fikk ny varetype`;
    case "active":
      return patch.isActive ? `${count} varer aktivert` : `${count} varer deaktivert`;
    case "primary_supplier":
      return `${count} varer fikk ny primærleverandør`;
  }
}

export function useBulkUpdateRawMaterials() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: BulkPatch }) => {
      if (ids.length === 0) return { count: 0, patch };
      if (patch.kind === "primary_supplier") {
        // Primær skrives bare via RPC-en — én råvare om gangen, med fremdrift.
        const tid = toast.loading(`Setter primærleverandør: 0 av ${ids.length}`);
        let done = 0;
        try {
          for (const id of ids) {
            await setPrimarySupplier(id, patch.supplierId);
            done += 1;
            toast.loading(`Setter primærleverandør: ${done} av ${ids.length}`, { id: tid });
          }
        } finally {
          toast.dismiss(tid);
        }
        return { count: done, patch };
      }
      const { error } = await supabase.from("raw_materials").update(patchFor(patch)).in("id", ids);
      if (error) throw error;
      return { count: ids.length, patch };
    },
    onSuccess: (res) => {
      invalidateRawMaterial(qc);
      if (res.count > 0) toast.success(labelFor(res.patch, res.count));
    },
    onError: (e: unknown) =>
      toast.error(`Kunne ikke oppdatere: ${e instanceof Error ? e.message : String(e)}`),
  });
}
