import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";


function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface RmSupplierRow {
  id: string;
  raw_material_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  package_confirmed_at: string | null;
  package_confirmed_by: string | null;
  agreed_price: number | null;
  agreed_price_per_base_unit: number | null;
  agreement_valid_from: string | null;
  agreement_valid_to: string | null;
  agreement_document_url: string | null;
  is_primary: boolean;
  last_invoice_price: number | null;
  last_invoice_date: string | null;
  notes: string | null;
}

export interface PriceHistoryRow {
  id: string;
  raw_material_id: string;
  supplier_id: string | null;
  price: number;
  effective_date: string;
  source: string;
  source_reference: string | null;
  invoice_id: string | null;
  notes: string | null;
  created_at: string;
  invoices?: { invoice_number: string | null; is_credit_note: boolean | null } | null;
}

export function useRawMaterialSuppliers(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw_material_suppliers", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select("*")
        .eq("raw_material_id", rawMaterialId!)
        .order("is_primary", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RmSupplierRow[];
    },
  });
}

export function useUpsertRmSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<RmSupplierRow> & { raw_material_id: string; supplier_id: string }) => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .upsert(input, { onConflict: "raw_material_id,supplier_id" })
        .select()
        .single();
      if (error) throw error;
      const row = data as RmSupplierRow;
      // Primær må holdes i synk begge veier: øvrige koblinger nullstilles og
      // råvaren peker på samme leverandør (kolonnen «Leverandør» i varelisten).
      if (input.is_primary) {
        const { error: othersErr } = await supabase
          .from("raw_material_suppliers")
          .update({ is_primary: false })
          .eq("raw_material_id", row.raw_material_id)
          .neq("id", row.id);
        if (othersErr) throw othersErr;
        const { error: rmErr } = await supabase
          .from("raw_materials")
          .update({ primary_supplier_id: row.supplier_id })
          .eq("id", row.raw_material_id);
        if (rmErr) throw rmErr;
      }
      return row;
    },
    onSuccess: (d) => {
      invalidateRawMaterial(qc, d.raw_material_id);
      toast.success("Lagret");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke lagre: ${errText(e)}`),
  });
}

export function useDeleteRmSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; raw_material_id: string }) => {
      const { error } = await supabase.from("raw_material_suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      invalidateRawMaterial(qc, vars.raw_material_id);
      toast.success("Fjernet");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke fjerne: ${errText(e)}`),
  });
}

export function usePriceHistory(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw_material_price_history", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_price_history")
        .select("*, invoices(invoice_number, is_credit_note)")
        .eq("raw_material_id", rawMaterialId!)
        .order("effective_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PriceHistoryRow[];
    },
  });
}

/** @deprecated bruk usePriceHistory */
export const n = usePriceHistory;

export function useAddPriceHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      raw_material_id: string;
      supplier_id: string | null;
      price: number;
      effective_date: string;
      source: string;
      notes?: string | null;
      set_as_current: boolean;
    }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error: histErr } = await supabase.from("raw_material_price_history").insert({
        raw_material_id: input.raw_material_id,
        created_by: auth.user?.id ?? null,
        supplier_id: input.supplier_id,
        price: input.price,
        effective_date: input.effective_date,
        source: input.source,
        notes: input.notes ?? null,
      });
      if (histErr) throw histErr;
      if (input.set_as_current) {
        const { error: rmErr } = await supabase
          .from("raw_materials")
          .update({
            current_cost_price: input.price,
            price_updated_at: new Date().toISOString(),
            price_source: input.source,
          })
          .eq("id", input.raw_material_id);
        if (rmErr) throw rmErr;
      }
    },
    onSuccess: (_d, vars) => {
      invalidateRawMaterial(qc, vars.raw_material_id);
      toast.success("Pris registrert");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke registrere: ${errText(e)}`),
  });
}
