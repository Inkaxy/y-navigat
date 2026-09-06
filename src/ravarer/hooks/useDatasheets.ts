import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ChangelogRow {
  id: string;
  raw_material_id: string;
  legal_entity_id: string;
  datasheet_id: string | null;
  change_type: string;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  severity: "high" | "medium" | "low";
  affected_recipes_count: number;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  raw_materials?: { name: string; sku: string };
}

export function useChangelog(opts?: { onlyUnacked?: boolean; rawMaterialId?: string }) {
  return useQuery({
    queryKey: ["raw-material-changelog", opts],
    queryFn: async () => {
      let q = supabase
        .from("raw_material_changelog")
        .select("*, raw_materials!inner(name, sku)")
        .order("created_at", { ascending: false });
      if (opts?.onlyUnacked) q = q.eq("acknowledged", false);
      if (opts?.rawMaterialId) q = q.eq("raw_material_id", opts.rawMaterialId);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return data as unknown as ChangelogRow[];
    },
  });
}

export function useUnackedChangelogCount() {
  return useQuery({
    queryKey: ["raw-material-changelog-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("raw_material_changelog")
        .select("*", { count: "exact", head: true })
        .eq("acknowledged", false)
        .in("severity", ["high", "medium"]);
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });
}

export function useAcknowledgeChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("raw_material_changelog")
        .update({ acknowledged: true, acknowledged_by: u.user?.id, acknowledged_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["raw-material-changelog"] });
      qc.invalidateQueries({ queryKey: ["raw-material-changelog-count"] });
      toast.success("Endring bekreftet");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Kunne ikke bekrefte endringen"),
  });
}

/** Datablad som aldri ble knyttet til en råvare — kandidater for opprydding. */
export function useOrphanDatasheets(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["orphan-datasheets", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_datasheets")
        .select("id, file_name, supplier_name, uploaded_at, status, ai_confidence")
        .eq("legal_entity_id", legalEntityId!)
        .is("raw_material_id", null)
        .order("uploaded_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDeleteDatasheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { error } = await supabase.from("raw_material_datasheets").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["orphan-datasheets"] });
      qc.invalidateQueries({ queryKey: ["raw-material-datasheets"] });
      toast.success(`${n} datablad slettet`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Kunne ikke slette"),
  });
}

export function useDatasheets(rawMaterialId: string | undefined) {
  return useQuery({
    queryKey: ["raw-material-datasheets", rawMaterialId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_datasheets")
        .select("*")
        .eq("raw_material_id", rawMaterialId!)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
