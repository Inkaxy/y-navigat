import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { showError } from "@/lib/userError";
import { NBE_LEGAL_ENTITY_ID } from "@/rapporter/lib/constants";
import { logAudit } from "@/rapporter/lib/audit";
import type { ReportConfig, ReportKind } from "@/rapporter/lib/reportConfig";

export type ReportDefinition = {
  id: string;
  display_name: string;
  report_kind: ReportKind;
  config: ReportConfig;
  is_favorite: boolean;
  sort_order: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const KEY = ["rapporter", "report-definitions"];

export function useReportDefinitions() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<ReportDefinition[]> => {
      const { data, error } = await supabase
        .from("report_definitions")
        .select("id, display_name, report_kind, config, is_favorite, sort_order, created_by, created_at, updated_at")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .order("is_favorite", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true });
      if (error) throw error;

      const rows = data ?? [];
      const ids = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean) as string[]));
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: users } = await supabase.from("users").select("id, display_name").in("id", ids);
        for (const u of users ?? []) names.set(u.id, u.display_name ?? "");
      }

      return rows.map((r) => ({
        id: r.id,
        display_name: r.display_name,
        report_kind: r.report_kind as ReportKind,
        config: (r.config ?? {}) as ReportConfig,
        is_favorite: r.is_favorite,
        sort_order: r.sort_order,
        created_by: r.created_by,
        created_by_name: r.created_by ? (names.get(r.created_by) ?? null) : null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    },
  });
}

export type SaveReportInput = {
  displayName: string;
  kind: ReportKind;
  config: ReportConfig;
  isFavorite: boolean;
};

export function useSaveReportDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveReportInput) => {
      const { data, error } = await supabase
        .from("report_definitions")
        .upsert(
          {
            legal_entity_id: NBE_LEGAL_ENTITY_ID,
            display_name: input.displayName.trim(),
            report_kind: input.kind,
            config: input.config as never,
            is_favorite: input.isFavorite,
          },
          { onConflict: "legal_entity_id,display_name" },
        )
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "create",
        entity_type: "report_definition",
        entity_id: data.id,
        entity_display_reference: input.displayName.trim(),
        changes: { report_kind: input.kind, config: input.config, is_favorite: input.isFavorite },
      });
      return data.id;
    },
    onSuccess: () => {
      toast.success("Rapporten er lagret");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => showError("report-definition-save", e, "Kunne ikke lagre rapporten"),
  });
}

export function useToggleReportFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; isFavorite: boolean; name: string }) => {
      const { error } = await supabase
        .from("report_definitions")
        .update({ is_favorite: input.isFavorite })
        .eq("id", input.id);
      if (error) throw error;
      await logAudit({
        action: "update",
        entity_type: "report_definition",
        entity_id: input.id,
        entity_display_reference: input.name,
        changes: { is_favorite: input.isFavorite },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => showError("report-definition-favorite", e, "Kunne ikke endre favoritt"),
  });
}

export function useDeleteReportDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      const { error } = await supabase.from("report_definitions").delete().eq("id", input.id);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity_type: "report_definition",
        entity_id: input.id,
        entity_display_reference: input.name,
      });
    },
    onSuccess: () => {
      toast.success("Rapporten er slettet");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => showError("report-definition-delete", e, "Kunne ikke slette rapporten"),
  });
}
