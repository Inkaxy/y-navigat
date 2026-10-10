import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import {
  EMPTY_COUNTS,
  type LinkSupplierItemBody,
  type LinkSupplierItemResult,
  type PackageInference,
  type SupplierItemLine,
  type SupplierItemsResult,
  type SupplierItemStatus,
} from "@/fakturaer/lib/supplierItems";

export const SUPPLIER_ITEMS_PAGE_SIZE = 25;

export interface SupplierItemFilters {
  supplierId: string | null;
  search: string;
  status: SupplierItemStatus | null;
  page: number;
  pageSize?: number;
  enabled?: boolean;
}

export function useSupplierItems(f: SupplierItemFilters) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const pageSize = f.pageSize ?? SUPPLIER_ITEMS_PAGE_SIZE;
  return useQuery({
    queryKey: ["supplier-items", le, { s: f.supplierId, q: f.search, st: f.status, p: f.page, ps: pageSize }],
    enabled: !!le && f.enabled !== false,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SupplierItemsResult> => {
      const { data, error } = await supabase.rpc("rm_supplier_items", {
        p_legal_entity_id: le!,
        p_supplier_id: f.supplierId ?? undefined,
        p_search: f.search.trim() || undefined,
        p_status: f.status ?? undefined,
        p_limit: pageSize,
        p_offset: (f.page - 1) * pageSize,
      });
      if (error) throw error;
      const r = (data ?? {}) as unknown as Partial<SupplierItemsResult>;
      return { total: Number(r.total ?? 0), counts: { ...EMPTY_COUNTS, ...(r.counts ?? {}) }, items: r.items ?? [] };
    },
  });
}

export function useSupplierItemLines(supplierId: string | null, itemKey: string | null) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["supplier-item-lines", le, supplierId, itemKey],
    enabled: !!le && !!supplierId && !!itemKey,
    queryFn: async (): Promise<SupplierItemLine[]> => {
      const { data, error } = await supabase.rpc("rm_supplier_item_lines", {
        p_legal_entity_id: le!,
        p_supplier_id: supplierId!,
        p_item_key: itemKey!,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as unknown as SupplierItemLine[];
    },
  });
}

export function usePackageInference(lineId: string | null, baseUnit: string | null) {
  return useQuery({
    queryKey: ["package-inference", lineId, baseUnit],
    enabled: !!lineId,
    queryFn: async (): Promise<PackageInference> => {
      const { data, error } = await supabase.rpc("rm_infer_package", { p_line_id: lineId!, p_base_unit: baseUnit ?? undefined });
      if (error) throw error;
      return data as unknown as PackageInference;
    },
  });
}

const FALLBACK = "Koblingen kunne ikke lagres. Prøv igjen — kontakt support hvis det gjentar seg.";

/** Serverens norske `error`-melding, aldri rå teknisk tekst. */
export async function linkErrorMessage(err: unknown): Promise<string> {
  if (err instanceof FunctionsHttpError) {
    try {
      const body: unknown = await err.context.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error.trim()) return body.error;
    } catch (e) {
      console.error("[link-supplier-item] uleselig feilsvar", e);
    }
  }
  return FALLBACK;
}

export function useLinkSupplierItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: LinkSupplierItemBody): Promise<LinkSupplierItemResult> => {
      const { data, error } = await supabase.functions.invoke("link-supplier-item", { body });
      if (error) throw new Error(await linkErrorMessage(error));
      const r = data as LinkSupplierItemResult | { error: string };
      if ("error" in r) throw new Error(r.error || FALLBACK);
      return { ...r, invoices: r.invoices ?? [], failures: r.failures ?? [] };
    },
    onSuccess: (r) => {
      ["supplier-items", "supplier-item-lines", "package-inference", "inbox-invoices", "invoice-approval-overview"].forEach((k) =>
        void qc.invalidateQueries({ queryKey: [k] }),
      );
      invalidateInvoice(qc);
      invalidateRawMaterial(qc, r.raw_material_id ?? undefined);
    },
  });
}
