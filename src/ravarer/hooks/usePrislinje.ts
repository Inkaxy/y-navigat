import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { fetchAllRowsExact } from "@/lib/countedPaging";
import { pendingSelect, useCapability } from "@/lib/pendingRpc";
import { parseCorrectionLog, type OpenPurchase, type PrislinjeRow } from "@/ravarer/lib/prislinje";

const n = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Alle leverandørkoblinger (råvare × leverandør) for selskapet, komplett hentet. */
export function usePrislinjeRows() {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "prislinje", le],
    enabled: !!le,
    staleTime: 60_000,
    queryFn: async (): Promise<PrislinjeRow[]> => {
      const rows = await fetchAllRowsExact((from, to) => supabase
        .from("raw_material_suppliers")
        .select("id, raw_material_id, supplier_id, is_primary, package_size, package_unit, base_units_per_package, container_unit, package_confirmed_at, last_invoice_date, updated_at, raw_materials!inner(id, name, base_unit, item_type, category, current_cost_price, cost_basis_status, allergens_reviewed_at, declaration_name, is_active, legal_entity_id, updated_at), suppliers!inner(id, name)", { count: "exact" })
        .eq("raw_materials.legal_entity_id", le!)
        .eq("raw_materials.is_active", true)
        .order("id")
        .range(from, to));
      return rows.map((r) => ({
        id: r.id, rawMaterialId: r.raw_material_id, supplierId: r.supplier_id,
        rmName: r.raw_materials.name, supplierName: r.suppliers.name ?? "Uten navn", baseUnit: r.raw_materials.base_unit,
        itemType: r.raw_materials.item_type ?? null, category: r.raw_materials.category ?? null,
        currentCost: n(r.raw_materials.current_cost_price), costStatus: r.raw_materials.cost_basis_status ?? null,
        allergensReviewedAt: r.raw_materials.allergens_reviewed_at ?? null, declarationName: r.raw_materials.declaration_name ?? null,
        isPrimary: !!r.is_primary, packageSize: n(r.package_size), packageUnit: r.package_unit ?? null, buPerPackage: n(r.base_units_per_package),
        containerUnit: r.container_unit ?? null, packageConfirmedAt: r.package_confirmed_at ?? null, lastInvoiceDate: r.last_invoice_date ?? null,
        updatedAt: r.updated_at, rmUpdatedAt: r.raw_materials.updated_at,
      }));
    },
  });
}

/** Åpne linjer (venter på svar) for råvare + leverandør: «Venter på deg»-søyler. */
export function useOpenPurchases(rawMaterialId: string | null, supplierId: string | null) {
  return useQuery({
    queryKey: ["ravarer", "prislinje-apne", rawMaterialId, supplierId],
    enabled: !!rawMaterialId && !!supplierId,
    queryFn: async (): Promise<OpenPurchase[]> => {
      const { data, error } = await supabase.from("invoice_lines")
        .select("id, price_per_base_unit, invoices!inner(invoice_date, supplier_id, status)")
        .eq("raw_material_id", rawMaterialId!).eq("requires_review", true).eq("invoices.supplier_id", supplierId!)
        .in("invoices.status", ["imported", "needs_review", "ready"]).limit(50);
      if (error) throw error;
      return (data ?? []).flatMap((l) => l.invoices?.invoice_date ? [{ id: l.id, date: l.invoices.invoice_date, price: n(l.price_per_base_unit) }] : []);
    },
  });
}

/** Har råvaren næringsverdier registrert? null = ukjent. */
export function useHasNutrition(rawMaterialId: string | null) {
  const q = useQuery({
    queryKey: ["ravarer", "har-naering", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { count, error } = await supabase.from("raw_material_nutrition").select("id", { count: "exact", head: true }).eq("raw_material_id", rawMaterialId!);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
  return q.isSuccess ? q.data : null;
}

/** Endringslogg fra rm_purchase_corrections (PENDING fase 2). `missing` = ikke kjørt. */
export function useCorrectionLog(rawMaterialId: string | null, unit: string) {
  const cap = useCapability("rm_cap_prislinje_v1");
  const q = useQuery({
    queryKey: ["ravarer", "prisrettinger", rawMaterialId],
    enabled: !!rawMaterialId && cap === true,
    queryFn: async () => {
      const r = await pendingSelect("rm_purchase_corrections", `select=id,kind,corrected_at,reason,corrected_by,before,after,reverted_at&raw_material_id=eq.${rawMaterialId}&order=corrected_at.desc&limit=100`);
      if (r.kind !== "ok") throw new Error("Endringsloggen kunne ikke hentes.");
      const rows = parseCorrectionLog(r.data, unit);
      if (!rows) throw new Error("Endringsloggen kunne ikke leses.");
      return rows;
    },
  });
  return { cap, ...q };
}

export interface PriceHistorySettings { deviationPct: number | null; sinceMonths: number | null }
/** Avviksgrense og periode i prishistorikken (nye kolonner, PENDING fase 2). null-felt = standard. */
export function usePriceHistorySettings() {
  const { data: company } = useCompany();
  const cap = useCapability("rm_cap_prislinje_v1");
  const q = useQuery({
    queryKey: ["ravarer", "prishistorikk-innstillinger", company?.id ?? null],
    enabled: !!company?.id && cap === true,
    queryFn: async (): Promise<PriceHistorySettings> => {
      const r = await pendingSelect("invoice_match_settings", `select=price_history_deviation_pct,price_history_since_months&legal_entity_id=eq.${company!.id}`);
      if (r.kind !== "ok" || !Array.isArray(r.data)) throw new Error("Innstillingene kunne ikke hentes.");
      const row = r.data[0] as Record<string, unknown> | undefined;
      return { deviationPct: n(row?.price_history_deviation_pct), sinceMonths: n(row?.price_history_since_months) };
    },
  });
  return { cap, ...q };
}
