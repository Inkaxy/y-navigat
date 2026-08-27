import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";

export interface RawMaterialUnitRow {
  id: string;
  raw_material_id: string;
  unit_label: string;
  units_in_base: number;
  is_default_purchase: boolean;
  is_default_count: boolean;
  is_sales_unit: boolean;
  sort_order: number;
  note: string | null;
}

const SELECT =
  "id, raw_material_id, unit_label, units_in_base, is_default_purchase, is_default_count, is_sales_unit, sort_order, note";

/** Enhetshierarkiet for én råvare, sortert. */
export function useRawMaterialUnits(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw-material-units", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async (): Promise<RawMaterialUnitRow[]> => {
      const { data, error } = await supabase
        .from("raw_material_units")
        .select(SELECT)
        .eq("raw_material_id", rawMaterialId!)
        .order("sort_order")
        .order("units_in_base");
      if (error) throw error;
      return (data ?? []) as RawMaterialUnitRow[];
    },
  });
}

/** Alle enheter for en liste råvarer — brukes til telleenhet på lagersiden. */
export function useRawMaterialUnitsFor(rawMaterialIds: string[]) {
  const ids = Array.from(new Set(rawMaterialIds)).sort();
  return useQuery({
    queryKey: ["raw-material-units-bulk", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Map<string, RawMaterialUnitRow[]>> => {
      const { data, error } = await supabase
        .from("raw_material_units")
        .select(SELECT)
        .in("raw_material_id", ids)
        .order("sort_order");
      if (error) throw error;
      const map = new Map<string, RawMaterialUnitRow[]>();
      for (const row of (data ?? []) as RawMaterialUnitRow[]) {
        const list = map.get(row.raw_material_id) ?? [];
        list.push(row);
        map.set(row.raw_material_id, list);
      }
      return map;
    },
  });
}

export interface UpsertUnitInput {
  id?: string;
  raw_material_id: string;
  unit_label: string;
  units_in_base: number;
  is_default_purchase?: boolean;
  is_default_count?: boolean;
  is_sales_unit?: boolean;
  sort_order?: number;
  note?: string | null;
}

export function useUpsertRawMaterialUnit() {
  const qc = useQueryClient();
  const { user } = useRavarer();
  return useMutation({
    mutationFn: async (input: UpsertUnitInput) => {
      if (input.id) {
        const { id, raw_material_id, ...patch } = input;
        const { error } = await supabase.from("raw_material_units").update(patch).eq("id", id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("raw_material_units").insert({
        raw_material_id: input.raw_material_id,
        unit_label: input.unit_label,
        units_in_base: input.units_in_base,
        is_default_purchase: input.is_default_purchase ?? false,
        is_default_count: input.is_default_count ?? false,
        is_sales_unit: input.is_sales_unit ?? false,
        sort_order: input.sort_order ?? 0,
        note: input.note ?? null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["raw-material-units", vars.raw_material_id] });
      qc.invalidateQueries({ queryKey: ["raw-material-units-bulk"] });
      toast.success("Enhet lagret");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke lagre enheten: ${e instanceof Error ? e.message : String(e)}`),
  });
}

export function useDeleteRawMaterialUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; raw_material_id: string }) => {
      const { error } = await supabase.from("raw_material_units").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["raw-material-units", vars.raw_material_id] });
      qc.invalidateQueries({ queryKey: ["raw-material-units-bulk"] });
      toast.success("Enhet slettet");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke slette: ${e instanceof Error ? e.message : String(e)}`),
  });
}

/** Enheten varen normalt telles i, hvis satt. */
export function defaultCountUnit(units: RawMaterialUnitRow[] | undefined): RawMaterialUnitRow | null {
  return units?.find(u => u.is_default_count) ?? null;
}

/** «4,5 sekker (112,5 kg)» — beholdning uttrykt i telleenheten. */
export function describeInCountUnit(
  stock: number,
  baseUnit: string,
  unit: RawMaterialUnitRow | null,
  fmt: (n: number, d?: number) => string,
): string {
  if (!unit || !(unit.units_in_base > 0)) return `${fmt(stock, 3)} ${baseUnit}`;
  return `${fmt(stock / unit.units_in_base, 2)} ${unit.unit_label} (${fmt(stock, 3)} ${baseUnit})`;
}
