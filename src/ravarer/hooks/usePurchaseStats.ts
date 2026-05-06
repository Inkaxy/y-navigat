import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";

export interface PurchaseStats {
  raw_material_id: string;
  legal_entity_id: string;
  quantity_30d: number;
  cost_30d: number;
  invoice_count_30d: number;
  quantity_90d: number;
  cost_90d: number;
  invoice_count_90d: number;
  quantity_12m: number;
  cost_12m: number;
  invoice_count_12m: number;
  quantity_24m: number;
  cost_24m: number;
  avg_price_per_base_unit_12m: number | null;
  avg_monthly_volume: number | null;
  last_invoice_date: string | null;
  supplier_count_12m: number;
  has_package_size_warning: boolean;
}

export function useRawMaterialPurchaseStats(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-stats", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_raw_material_purchase_stats", {
        p_raw_material_id: rawMaterialId!,
      });
      if (error) throw error;
      return (data ?? null) as PurchaseStats | null;
    },
    staleTime: 60_000,
  });
}

export function useAllRawMaterialPurchaseStats() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["purchase-stats-all", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_raw_material_purchase_stats", {
        p_legal_entity_id: legalEntityId,
      });
      if (error) throw error;
      const map = new Map<string, PurchaseStats>();
      for (const r of (data ?? []) as PurchaseStats[]) map.set(r.raw_material_id, r);
      return map;
    },
    staleTime: 60_000,
  });
}

export interface SupplierPurchaseStats {
  raw_material_id: string;
  supplier_id: string;
  legal_entity_id: string;
  quantity_12m: number;
  cost_12m: number;
  invoice_count_12m: number;
  quantity_24m: number;
  cost_24m: number;
  last_invoice_date: string | null;
}

export function useSupplierPurchaseStats(supplierId: string | undefined) {
  return useQuery({
    queryKey: ["supplier-purchase-stats", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_supplier_purchase_stats", {
        p_supplier_id: supplierId!,
      });
      if (error) throw error;
      return (data ?? []) as SupplierPurchaseStats[];
    },
    staleTime: 60_000,
  });
}
