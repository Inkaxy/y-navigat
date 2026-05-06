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
  old_value: any;
  new_value: any;
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
    onError: (e: any) => toast.error(e.message),
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
