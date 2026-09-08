import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import type { RawMaterialSearchIndex } from "@/ravarer/hooks/useRawMaterialSearchIndex";


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
  agreed_price_set_at: string | null;
  agreed_price_set_by: string | null;
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

/** Delt kontrakt for ["raw_material_suppliers", id] — komplette koblingsrader. */
export function rmSuppliersQueryOptions(rawMaterialId: string | undefined) {
  return {
    queryKey: ["raw_material_suppliers", rawMaterialId] as const,
    enabled: !!rawMaterialId,
    queryFn: async (): Promise<RmSupplierRow[]> => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select("*")
        .eq("raw_material_id", rawMaterialId!)
        .order("is_primary", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RmSupplierRow[];
    },
  };
}

export function useRawMaterialSuppliers(rawMaterialId: string | undefined) {
  return useQuery(rmSuppliersQueryOptions(rawMaterialId));
}

/** Alias-nøkkelen brukes både av fakturamodulen og leverandørfanen. */
function invalidateSupplierAliases(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["supplier-aliases"] });
  void qc.invalidateQueries({ queryKey: ["supplier-aliases-all"] });
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
      } else if (input.is_primary === false) {
        // Slås primær AV på raden som var primær, må råvaren slutte å peke på
        // leverandøren — ellers viser varelisten en leverandør som ikke lenger
        // er hovedleverandør.
        const { error: rmErr } = await supabase
          .from("raw_materials")
          .update({ primary_supplier_id: null })
          .eq("id", row.raw_material_id)
          .eq("primary_supplier_id", row.supplier_id);
        if (rmErr) throw rmErr;
      }
      return row;
    },
    // Optimistisk: avtaleprisen i varelisten (søkeindeksen) oppdateres med én
    // gang, og rulles tilbake dersom lagringen feiler.
    onMutate: async (input) => {
      if (input.agreed_price_per_base_unit === undefined) return { snapshots: [] as Array<[unknown[], RawMaterialSearchIndex | undefined]> };
      await qc.cancelQueries({ queryKey: ["raw_material_search_index"] });
      const entries = qc.getQueriesData<RawMaterialSearchIndex>({
        queryKey: ["raw_material_search_index"],
      });
      const snapshots: Array<[unknown[], RawMaterialSearchIndex | undefined]> = [];
      for (const [key, index] of entries) {
        snapshots.push([key as unknown[], index]);
        if (!index) continue;
        const rows = index.linksByRawMaterial.get(input.raw_material_id);
        if (!rows) continue;
        const nextMap = new Map(index.linksByRawMaterial);
        nextMap.set(
          input.raw_material_id,
          rows.map((r) =>
            r.supplierId === input.supplier_id
              ? { ...r, agreedPricePerBaseUnit: input.agreed_price_per_base_unit ?? null }
              : r,
          ),
        );
        qc.setQueryData(key, { ...index, linksByRawMaterial: nextMap });
      }
      return { snapshots };
    },
    onError: (e: unknown, _vars, context) => {
      context?.snapshots.forEach(([key, index]) => qc.setQueryData(key, index));
      toast.error(`Kunne ikke lagre: ${errText(e)}`);
    },
    onSuccess: (d) => {
      invalidateSupplierAliases(qc);
      toast.success("Lagret");
    },
    onSettled: (d, _e, vars) => {
      invalidateRawMaterial(qc, d?.raw_material_id ?? vars.raw_material_id);
    },
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
      invalidateSupplierAliases(qc);
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
  // Innlogget bruker ligger allerede i konteksten — ingen ekstra rundtur
  // til auth per lagring.
  const { user } = useRavarer();
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
      const { error: histErr } = await supabase.from("raw_material_price_history").insert({
        raw_material_id: input.raw_material_id,
        created_by: user?.id ?? null,
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
    // Optimistisk: kostprisen i listen og på detaljen oppdateres med én gang.
    onMutate: async (input) => {
      if (!input.set_as_current) {
        return {
          lists: [] as Array<[unknown[], RawMaterialRow[] | undefined]>,
          detail: [] as Array<[unknown[], RawMaterialRow | null | undefined]>,
        };
      }
      const id = input.raw_material_id;
      await qc.cancelQueries({ queryKey: ["raw_materials"] });
      await qc.cancelQueries({ queryKey: ["raw_material", id] });
      const lists = qc
        .getQueriesData<RawMaterialRow[]>({ queryKey: ["raw_materials"] })
        .map(([key, rows]) => [key as unknown[], rows] as [unknown[], RawMaterialRow[] | undefined]);
      const detail = qc
        .getQueriesData<RawMaterialRow | null>({ queryKey: ["raw_material", id] })
        .map(
          ([key, row]) => [key as unknown[], row] as [unknown[], RawMaterialRow | null | undefined],
        );
      const patch = {
        current_cost_price: input.price,
        price_source: input.source,
        price_updated_at: new Date().toISOString(),
      };
      for (const [key, rows] of lists) {
        if (!Array.isArray(rows)) continue;
        qc.setQueryData(
          key,
          rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        );
      }
      for (const [key, row] of detail) {
        if (!row) continue;
        qc.setQueryData(key, { ...row, ...patch });
      }
      return { lists, detail };
    },
    onError: (e: unknown, _vars, context) => {
      context?.lists.forEach(([key, rows]) => qc.setQueryData(key, rows));
      context?.detail.forEach(([key, row]) => qc.setQueryData(key, row));
      toast.error(`Kunne ikke registrere: ${errText(e)}`);
    },
    onSuccess: () => {
      toast.success("Pris registrert");
    },
    onSettled: (_d, _e, vars) => {
      invalidateRawMaterial(qc, vars.raw_material_id);
    },
  });
}
