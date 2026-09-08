import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { supplierSpendExclVat } from "@/ravarer/lib/purchaseTotals";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";
import { osloDateISOPlusDays } from "@/lib/osloDate";
import { fetchAllRows } from "@/lib/supabasePaging";

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

/** Totalt innkjøp fra alle leverandører siste 365 dager, eks. mva. */
export function useTotalSpend(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["total-supplier-spend", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const since = osloDateISOPlusDays(-365);
      const rows = await fetchAllRows<{ total_amount: number | null; total_vat: number | null; is_credit_note: boolean | null }>(
        (from, to) =>
          supabase
            .from("invoices")
            .select("total_amount, total_vat, is_credit_note")
            .eq("legal_entity_id", legalEntityId!)
            .gte("invoice_date", since)
            .range(from, to),
      );
      return supplierSpendExclVat(rows);
    },
  });
}

export interface SupplierPriceIndex {
  /** Snitt av (siste fakturapris / 12-måneders snittpris) per råvare, i prosent. */
  indexPct: number | null;
  /** Antall råvarer indeksen bygger på. */
  materials: number;
}

/**
 * Prisindeks for leverandøren: hvor mye siste fakturapris ligger over eller
 * under snittet det siste året, snittet over råvarene.
 */
export function useSupplierPriceIndex(supplierId: string | undefined) {
  return useQuery({
    queryKey: ["supplier-price-index", supplierId],
    enabled: !!supplierId,
    queryFn: async (): Promise<SupplierPriceIndex> => {
      const since = osloDateISOPlusDays(-365);
      const invoices = await fetchAllRows<{ id: string }>((from, to) =>
        supabase
          .from("invoices")
          .select("id")
          .eq("supplier_id", supplierId!)
          .eq("is_credit_note", false)
          .gte("invoice_date", since)
          .range(from, to),
      );
      if (invoices.length === 0) return { indexPct: null, materials: 0 };
      const ids = invoices.map((i) => i.id);

      const lines: { raw_material_id: string | null; price_per_base_unit: number | null; created_at: string }[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const part = await fetchAllRows<{ raw_material_id: string | null; price_per_base_unit: number | null; created_at: string }>(
          (from, to) =>
            supabase
              .from("invoice_lines")
              .select("raw_material_id, price_per_base_unit, created_at")
              .in("invoice_id", chunk)
              .not("raw_material_id", "is", null)
              .not("price_per_base_unit", "is", null)
              .range(from, to),
        );
        lines.push(...part);
      }

      const byMaterial = new Map<string, { sum: number; n: number; latest: { at: string; price: number } | null }>();
      for (const l of lines) {
        const rm = l.raw_material_id;
        const price = Number(l.price_per_base_unit);
        if (!rm || !Number.isFinite(price) || price <= 0) continue;
        const entry = byMaterial.get(rm) ?? { sum: 0, n: 0, latest: null };
        entry.sum += price;
        entry.n += 1;
        if (!entry.latest || l.created_at > entry.latest.at) entry.latest = { at: l.created_at, price };
        byMaterial.set(rm, entry);
      }

      const ratios: number[] = [];
      for (const e of byMaterial.values()) {
        if (e.n < 2 || !e.latest) continue;
        const avg = e.sum / e.n;
        if (avg <= 0) continue;
        ratios.push(e.latest.price / avg);
      }
      if (ratios.length === 0) return { indexPct: null, materials: byMaterial.size };
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      return { indexPct: mean * 100, materials: ratios.length };
    },
  });
}
