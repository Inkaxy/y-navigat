import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";

export interface RawMaterialRow {
  id: string;
  legal_entity_id: string;
  sku: string;
  name: string;
  declaration_name: string | null;
  description: string | null;
  category: string | null;
  categories: string[];
  item_type: "ravare" | "emballasje" | "forbruksvare" | "videresalg";
  is_packaging: boolean;
  is_resale_item: boolean;
  stock_tracking: boolean;
  base_unit: string;

  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  package_confirmed_at: string | null;
  package_confirmed_by: string | null;
  current_cost_price: number | null;
  agreed_price: number | null;
  price_updated_at: string | null;
  price_source: string | null;
  current_stock: number;
  min_stock: number | null;
  is_active: boolean;
  primary_supplier_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useRawMaterials() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["raw_materials", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RawMaterialRow[];
    },
  });
}

export function useRawMaterial(id: string | undefined) {
  return useQuery({
    queryKey: ["raw_material", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as RawMaterialRow | null;
    },
  });
}

export function useCreateRawMaterial() {
  const qc = useQueryClient();
  const { legalEntityId, user } = useRavarer();
  return useMutation({
    mutationFn: async (input: Partial<RawMaterialRow> & { sku: string; name: string; base_unit: string }) => {
      const { data, error } = await supabase
        .from("raw_materials")
        .insert({
          legal_entity_id: legalEntityId,
          created_by: user?.id ?? null,
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          category: input.category ?? null,
          is_packaging: input.is_packaging ?? false,
          base_unit: input.base_unit,
          package_size: input.package_size ?? null,
          package_unit: input.package_unit ?? null,
          current_cost_price: input.current_cost_price ?? null,
          agreed_price: input.agreed_price ?? null,
          current_stock: input.current_stock ?? 0,
          min_stock: input.min_stock ?? null,
          is_active: input.is_active ?? true,
          primary_supplier_id: input.primary_supplier_id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as RawMaterialRow;
    },
    onSuccess: (data) => {
      invalidateRawMaterial(qc, data.id);
      toast.success("Råvare opprettet");
    },
    onError: (e: any) => toast.error(`Kunne ikke opprette: ${e.message ?? e}`),
  });
}

export function useUpdateRawMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<RawMaterialRow> & { id: string }) => {
      const { data, error } = await supabase
        .from("raw_materials")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as RawMaterialRow;
    },
    onSuccess: (data) => {
      invalidateRawMaterial(qc, data.id);
      toast.success("Lagret");
    },
    onError: (e: any) => toast.error(`Kunne ikke lagre: ${e.message ?? e}`),
  });
}

export function useRenameRawMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase.rpc("rename_raw_material", { p_id: id, p_name: name });
      if (error) throw error;
      return data as RawMaterialRow;
    },
    onSuccess: (data) => {
      invalidateRawMaterial(qc, data.id);
      toast.success("Navn oppdatert");
    },
    onError: (e: any) => toast.error(`Kunne ikke endre navn: ${e.message ?? e}`),
  });
}

export function useDeleteRawMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("raw_materials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateRawMaterial(qc);
      toast.success("Slettet");
    },
    onError: (e: any) => toast.error(`Kunne ikke slette: ${e.message ?? e}`),
  });
}
