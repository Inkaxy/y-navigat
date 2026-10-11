import { setPrimarySupplier } from "@/ravarer/lib/supplierLinkRpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useRavarerScope } from "@/ravarer/hooks/useRavarerScope";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import type { RawMaterialSearchIndex } from "@/ravarer/hooks/useRawMaterialSearchIndex";
import { fetchAllRows } from "@/lib/supabasePaging";
import type { TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";
import { documentedPriceError, documentedPriceMessage, parseDocumentedPrice, type DocumentedPriceResult } from "@/ravarer/lib/costPriceSource";


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
  // Startpris — settes kun av de godkjente RPC-ene, aldri direkte fra klienten.
  start_price_per_base_unit?: number | null;
  start_price_currency?: string | null;
  start_price_base_unit?: string | null;
  start_price_base_units_per_package?: number | null;
  start_price_package_size?: number | null;
  start_price_package_unit?: string | null;
  start_price_invoice_id?: string | null;
  start_price_invoice_line_id?: string | null;
  start_price_effective_date?: string | null;
  start_price_confirmed_at?: string | null;
  start_price_confirmed_by?: string | null;
  start_price_unit_change_at?: string | null;
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
  superseded_reason?: string | null;
  superseded_at?: string | null;
  is_legacy?: boolean | null;
  is_credit?: boolean | null;
  currency?: string | null;
  invoice_line_id?: string | null;
  invoices?: { invoice_number: string | null; is_credit_note: boolean | null } | null;
}

/** Én mapping fra historikkrad til tidslinjerad — brukes av alle visninger (skjerm og CSV). */
export function toTimelineRow(h: PriceHistoryRow): TimelineHistoryRow {
  return {
    id: h.id, effective_date: h.effective_date, price: Number(h.price), supplier_id: h.supplier_id,
    source: h.source ?? "manual", invoice_id: h.invoice_id, invoiceNumber: h.invoices?.invoice_number ?? null,
    isCreditNote: h.invoices?.is_credit_note ?? false, notes: h.notes ?? null,
    supersededAt: h.superseded_at ?? null, supersededReason: h.superseded_reason ?? null,
    isLegacy: !!h.is_legacy, isCredit: !!h.is_credit, currency: h.currency ?? "NOK",
  };
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
      // Primær skrives ALDRI direkte — bare via `rm_set_primary_supplier`.
      const { is_primary: wantPrimary, ...rest } = input;
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .upsert(rest, { onConflict: "raw_material_id,supplier_id" })
        .select()
        .single();
      if (error) throw error;
      const row = data as RmSupplierRow;
      if (wantPrimary === true) {
        await setPrimarySupplier(row.raw_material_id, row.supplier_id);
        row.is_primary = true;
      } else if (wantPrimary === false && row.is_primary) {
        await setPrimarySupplier(row.raw_material_id, null);
        row.is_primary = false;
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
    onSuccess: () => {
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
    // Alle rader (sidevis) — ingen stille avkutting ved 1000.
    queryFn: () => fetchAllRows<PriceHistoryRow>((from, to) =>
      supabase
        .from("raw_material_price_history")
        .select("id, raw_material_id, supplier_id, price, effective_date, source, source_reference, invoice_id, invoice_line_id, notes, created_at, superseded_at, superseded_reason, is_legacy, is_credit, currency, invoices(invoice_number, is_credit_note)")
        .eq("raw_material_id", rawMaterialId as string)
        .order("effective_date", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
        .returns<PriceHistoryRow[]>()),
  });
}

/** @deprecated bruk usePriceHistory */
export const n = usePriceHistory;

/**
 * Manuell dokumentert pris: én atomisk server-RPC (historikk + revisjon + felles prisvelger).
 * Serveren avgjør om prisen blir gjeldende (nyeste gyldige pris etter dato); `set_as_current` er bare ønsket.
 */
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
    }): Promise<DocumentedPriceResult> => {
      const { data, error } = await supabase.rpc("rm_set_documented_cost_price", {
        p_raw_material_id: input.raw_material_id,
        p_price: input.price,
        p_effective_date: input.effective_date,
        p_reason: (input.notes ?? "").trim(),
        p_supplier_id: input.supplier_id ?? undefined,
        p_source: ["manual", "agreement", "price_list"].includes(input.source) ? input.source : "manual",
      });
      if (error) throw new Error(documentedPriceError(error.message));
      return parseDocumentedPrice(data);
    },
    onError: (e: unknown) => toast.error(`Kunne ikke registrere: ${errText(e)}`),
    onSuccess: (r) => { toast.success(documentedPriceMessage(r)); },
    onSettled: (_d, _e, vars) => { invalidateRawMaterial(qc, vars.raw_material_id); },
  });
}
