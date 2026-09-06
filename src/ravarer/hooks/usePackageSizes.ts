import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";

export type PackageStatus =
  | "mangler_pakning"
  | "avviker_fra_referanse"
  | "ustabil_pris"
  | "linjer_uten_pris"
  | "mangler_kostpris"
  | "ikke_bekreftet"
  | "ingen_fakturaer"
  | "ok";

export interface PackageWorklistRow {
  id: string;
  legal_entity_id: string | null;
  name: string | null;
  base_unit: string | null;
  category: string | null;
  current_cost_price: number | null;
  pakningsfaktor: number | null;
  faktor_kilde: string | null;
  bekreftet_dato: string | null;
  antall_fakturalinjer: number | null;
  antall_leverandorer: number | null;
  enheter_i_bruk: string | null;
  linjer_uten_pris: number | null;
  kjopt_kr_totalt: number | null;
  siste_faktura: string | null;
  pris_spredning: number | null;
  implisert_mengde: number | null;
  referansepris: number | null;
  referansekilde: string | null;
  referansedato: string | null;
  referanse_faktor: number | null;
  foreslatt_fra_navn: number | null;
  foreslatt_fra_referanse: number | null;
  status: PackageStatus | string | null;
}

export interface PackageChangeRow {
  line_id: string;
  invoice_date: string | null;
  invoice_number: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  total_amount: number | null;
  old_ppb: number | null;
  new_ppb: number | null;
  new_base_qty: number | null;
  method: "direkte" | "pakning" | "ukjent_enhet" | "mangler_antall" | string;
  factor: number | null;
  factor_source: string | null;
  avvik_pct: number | null;
  outlier: boolean;
}

export interface PackageRpcResult {
  ok: boolean;
  dry_run: boolean;
  recalc_id: string | null;
  raw_material: string | null;
  base_unit: string | null;
  factor: number | null;
  factor_source: string | null;
  lines_total: number;
  lines_changed: number;
  lines_unknown: number;
  lines_outlier: number;
  ppb_median: number | null;
  cost_before: number | null;
  cost_after: number | null;
  changes: PackageChangeRow[];
}

export interface SetPackageInput {
  p_raw_material_id: string;
  p_base_units_per_package: number;
  p_supplier_id?: string | null;
  p_supplier_base_units?: number | null;
  p_package_unit?: string | null;
  p_apply: boolean;
  p_reason?: string | null;
}

export function usePackageWorklist() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["raw_material_package_worklist", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_package_worklist")
        .select("*")
        .eq("legal_entity_id", legalEntityId);
      if (error) throw error;
      return (data ?? []) as PackageWorklistRow[];
    },
  });
}

async function callSetPackage(input: SetPackageInput): Promise<PackageRpcResult> {
  const args: Record<string, unknown> = {
    p_raw_material_id: input.p_raw_material_id,
    p_base_units_per_package: input.p_base_units_per_package,
    p_apply: input.p_apply,
  };
  if (input.p_supplier_id) args.p_supplier_id = input.p_supplier_id;
  if (input.p_supplier_base_units != null) args.p_supplier_base_units = input.p_supplier_base_units;
  if (input.p_package_unit) args.p_package_unit = input.p_package_unit;
  if (input.p_reason) args.p_reason = input.p_reason;

  const { data, error } = await supabase.rpc("set_raw_material_package", args as never);
  if (error) throw error;
  return data as unknown as PackageRpcResult;
}

/** Forhåndsvisning — lagrer ingenting. */
export function usePreviewPackage() {
  return useMutation({
    mutationFn: (input: Omit<SetPackageInput, "p_apply">) => callSetPackage({ ...input, p_apply: false }),
    onError: (e: any) => toast.error(`Kunne ikke forhåndsvise: ${e.message ?? e}`),
  });
}

export function useInvalidatePackageQueries() {
  const qc = useQueryClient();
  return (rawMaterialId?: string) => {
    invalidateRawMaterial(qc, rawMaterialId);
  };
}

export function useApplyPackage() {
  const invalidate = useInvalidatePackageQueries();
  return useMutation({
    mutationFn: (input: Omit<SetPackageInput, "p_apply">) => callSetPackage({ ...input, p_apply: true }),
    onSuccess: (_res, vars) => invalidate(vars.p_raw_material_id),
    onError: (e: any) => toast.error(`Kunne ikke lagre: ${e.message ?? e}`),
  });
}

export function useUndoRecalc() {
  const invalidate = useInvalidatePackageQueries();
  return useMutation({
    mutationFn: async ({ recalcId }: { recalcId: string; rawMaterialId?: string }) => {
      const { data, error } = await supabase.rpc("undo_raw_material_recalc", { p_recalc_id: recalcId });
      if (error) throw error;
      return data as unknown as { ok: boolean; lines_restored: number; cost_restored: number | null };
    },
    onSuccess: (_d, vars) => {
      invalidate(vars.rawMaterialId);
      toast.success("Omregningen er angret");
    },
    onError: (e: any) => toast.error(`Kunne ikke angre: ${e.message ?? e}`),
  });
}

export interface RecalcRow {
  id: string;
  raw_material_id: string;
  performed_at: string;
  performed_by: string | null;
  reason: string | null;
  factor_used: number | null;
  factor_source: string | null;
  lines_changed: number | null;
  cost_before: number | null;
  cost_after: number | null;
  undone_at: string | null;
  performed_by_name?: string | null;
}

export function useRecalcHistory(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw_material_cost_recalcs", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_cost_recalcs")
        .select("*")
        .eq("raw_material_id", rawMaterialId!)
        .order("performed_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as RecalcRow[];
      const ids = Array.from(new Set(rows.map(r => r.performed_by).filter(Boolean))) as string[];
      if (ids.length === 0) return rows;
      const { data: users } = await supabase.from("users").select("id, display_name").in("id", ids);
      const map = new Map((users ?? []).map(u => [u.id, u.display_name]));
      return rows.map(r => ({ ...r, performed_by_name: r.performed_by ? map.get(r.performed_by) ?? null : null }));
    },
  });
}
