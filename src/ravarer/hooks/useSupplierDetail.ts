import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { supplierSpendExclVat } from "@/ravarer/lib/purchaseTotals";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";
import { osloDateISOPlusDays } from "@/lib/osloDate";

export interface SupplierItemRow {
  id: string;
  raw_material_id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  package_size: number | null;
  package_unit: string | null;
  agreed_price_per_base_unit: number | null;
  agreement_valid_from: string | null;
  agreement_valid_to: string | null;
  last_invoice_price: number | null;
  last_invoice_date: string | null;
  raw_material: { id: string; name: string; base_unit: string | null; item_type: string | null } | null;
}

export interface SupplierInvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number | null;
  status: string;
  lines_sum_status: string | null;
}

export interface SupplierAliasRow {
  id: string;
  alias_value: string;
  alias_type: string;
  status: string;
  match_count: number | null;
  last_seen_at: string | null;
  raw_material_supplier_id: string;
}

/** Én leverandør. */
export function useSupplier(id: string | undefined) {
  return useQuery({
    queryKey: ["supplier", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as SupplierRow | null;
    },
  });
}

/** Varer koblet til leverandøren. */
export function useSupplierItems(supplierId: string | undefined) {
  return useQuery({
    queryKey: ["supplier-items", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select(
          "id, raw_material_id, supplier_sku, supplier_product_name, package_size, package_unit, agreed_price_per_base_unit, agreement_valid_from, agreement_valid_to, last_invoice_price, last_invoice_date, raw_material:raw_materials(id, name, base_unit, item_type)",
        )
        .eq("supplier_id", supplierId!);
      if (error) throw error;
      return (data ?? []) as unknown as SupplierItemRow[];
    },
  });
}

/** Fakturaer for leverandøren (paginert med «vis flere»). */
export function useSupplierInvoices(supplierId: string | undefined, limit: number) {
  return useQuery({
    queryKey: ["supplier-invoices", supplierId, limit],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("invoices")
        .select("id, invoice_number, invoice_date, total_amount, status, lines_sum_status", { count: "exact" })
        .eq("supplier_id", supplierId!)
        .order("invoice_date", { ascending: false })
        .range(0, limit - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as SupplierInvoiceRow[], total: count ?? 0 };
    },
  });
}

/** Sum kjøpt siste 365 dager. */
export function useSupplierSpend(supplierId: string | undefined) {
  return useQuery({
    queryKey: ["supplier-spend", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const since = osloDateISOPlusDays(-365);
      const { data, error } = await supabase
        .from("invoices")
        .select("total_amount, total_vat, is_credit_note")
        .eq("supplier_id", supplierId!)
        .gte("invoice_date", since);
      if (error) throw error;
      return supplierSpendExclVat(data ?? []);
    },
  });
}

/** Aliaser for leverandørens koblinger. */
export function useSupplierAliases(linkIds: string[]) {
  const key = [...linkIds].sort().join(",");
  return useQuery({
    queryKey: ["supplier-aliases", key],
    enabled: linkIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_supplier_aliases")
        .select("id, alias_value, alias_type, status, match_count, last_seen_at, raw_material_supplier_id")
        .in("raw_material_supplier_id", linkIds)
        .order("alias_value");
      if (error) throw error;
      return (data ?? []) as unknown as SupplierAliasRow[];
    },
  });
}

export function useUpdateSupplierNotes(supplierId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notes: string) => {
      const { error } = await supabase.from("suppliers").update({ notes }).eq("id", supplierId!);
      if (error) throw error;
      return notes;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier", supplierId] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Notat lagret");
    },
    onError: (e: Error) => toast.error(`Kunne ikke lagre: ${e.message}`),
  });
}
