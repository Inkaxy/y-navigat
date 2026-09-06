import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import type { ItemType } from "@/ravarer/lib/itemTypes";

/**
 * Massehandlinger fra varelisten. Alle handlinger kjører som én oppdatering
 * mot valgte id-er og gir én samlet toast — ikke én per rad.
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
  primary_supplier_id?: string;
}

function patchFor(patch: BulkPatch): RawMaterialPatch {
  switch (patch.kind) {
    case "category":
      return { category: patch.category };
    case "item_type":
      return { item_type: patch.itemType };
    case "active":
      return { is_active: patch.isActive };
    case "primary_supplier":
      return { primary_supplier_id: patch.supplierId };
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
